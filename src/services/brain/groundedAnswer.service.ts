import OpenAI from "openai";
import { env } from "../../config/env";
import logger from "../../utils/logger";
import { recordBrainAudit } from "../brainAudit.service";
import { buildGroundedPrompt, composeAnswer, parseModelOutput, validateStatements } from "./grounding";
import { retrieveEvidence } from "./retrieval";
import type { Citation, Evidence } from "./types";

/*
 * Strict (grounded) Brain answers, contract A6 / plan R4:
 * retrieve -> fewer than minEvidenceCount items => "not enough stored information" WITHOUT calling the model ->
 * model (JSON statements) -> parse (any bad output / provider error => insufficient, never a 500) -> validate every
 * statement (citation must resolve, never guidance, every number must be a stored token of the CITED text) ->
 * compose (bullets + "Based on N stored records" + citations).
 *
 * Known design limit (not solved here): the number gate matches numbers token-by-token against ALL cited text, so a
 * stored number used for the wrong field ("ran 167 days" citing a row with max_stroke_in=167) is not caught.
 *
 * Logs and audit carry ids and counts only: never the question, evidence, prompt or answer.
 */

export interface GroundedResult {
  reply: string;
  citations: Citation[];
  insufficient: boolean;
  usedCount: number;
}

export interface GroundedPorts {
  retrieve(p: { categoryId: string }, question: string): Promise<{ evidence: Evidence[]; guidance: string[]; searched?: number }>;
  callModel(prompt: { system: string; user: string }): Promise<string>;
  /** Defaults to recordBrainAudit(BRAIN_ANSWER_INSUFFICIENT_EVIDENCE). Must never break the answer. */
  audit?(meta: { categoryId: string; counts: number }): Promise<void>;
}

export interface GroundedInput {
  category: { _id: string; name: string; minEvidenceCount: number };
  question: string;
  userId?: string;
}

/** Guidance-flagged ids are never evidence (a flagged duplicate removes the id entirely); then first id wins. */
const cleanEvidence = (items: Evidence[]): Evidence[] => {
  const flagged = new Set(items.filter((e) => e && e.isGuidance).map((e) => e.id));
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of items) {
    if (!e || typeof e.id !== "string" || flagged.has(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
};

const insufficient = (evidence: Evidence[], minEvidenceCount: number): GroundedResult =>
  composeAnswer({ kept: [], evidence, minEvidenceCount });

/** The insufficient reply reports how many stored items were searched (all candidates), not only those selected. */
const withSearched = (result: GroundedResult, selected: number, searched: number | undefined): GroundedResult =>
  result.insufficient && typeof searched === "number" && Number.isFinite(searched) && searched > selected
    ? { ...result, reply: result.reply.replace(`Searched: ${selected} stored records.`, `Searched: ${searched} stored records.`) }
    : result;

/** Pure orchestration over injected ports (fully fixturable). Never throws. */
export async function answerGroundedWith(ports: GroundedPorts, p: GroundedInput): Promise<GroundedResult> {
  const categoryId = String(p.category._id);
  const min = p.category.minEvidenceCount;
  const audit = async (count: number): Promise<void> => {
    try {
      if (ports.audit) await ports.audit({ categoryId, counts: count });
      else {
        await recordBrainAudit({
          userId: p.userId,
          action: "BRAIN_ANSWER_INSUFFICIENT_EVIDENCE",
          target: "brain_chat",
          metadata: { categoryId, counts: count },
        });
      }
    } catch {
      /* audit failures never break the answer */
    }
  };
  const finish = async (result: GroundedResult, evidenceCount: number, stage: string): Promise<GroundedResult> => {
    logger.info(
      `[brain:grounded] categoryId=${categoryId} stage=${stage} evidence=${evidenceCount} used=${result.usedCount} insufficient=${result.insufficient}`,
    );
    if (result.insufficient) await audit(evidenceCount);
    return withSearched(result, evidenceCount, searched);
  };

  let evidence: Evidence[] = [];
  let guidance: string[] = [];
  let searched: number | undefined;
  try {
    const retrieved = await ports.retrieve({ categoryId }, p.question);
    evidence = cleanEvidence(retrieved.evidence ?? []);
    guidance = (retrieved.guidance ?? []).filter((g) => typeof g === "string");
    searched = retrieved.searched;
  } catch (e) {
    logger.warn(`[brain:grounded] categoryId=${categoryId} retrieval failed error=${e instanceof Error ? e.name : "Error"}`);
    return finish(insufficient([], min), 0, "retrieve_error");
  }
  if (evidence.length < min || evidence.length === 0) {
    return finish(insufficient(evidence, min), evidence.length, "too_little_evidence");
  }

  const prompt = buildGroundedPrompt({ categoryName: p.category.name, question: p.question, evidence, guidance });
  let statements;
  try {
    const raw = await ports.callModel(prompt);
    statements = parseModelOutput(raw);
  } catch (e) {
    // GroundingError(BAD_MODEL_OUTPUT), provider errors, timeouts, missing key: never an ungrounded fallback
    logger.warn(`[brain:grounded] categoryId=${categoryId} model failed error=${e instanceof Error ? e.name : "Error"}`);
    return finish(insufficient(evidence, min), evidence.length, "model_error");
  }
  const { kept, dropped } = validateStatements(statements, evidence);
  logger.info(`[brain:grounded] categoryId=${categoryId} statements=${statements.length} kept=${kept.length} dropped=${dropped.length}`);
  const result = composeAnswer({ kept, evidence, minEvidenceCount: min });
  return finish(result, evidence.length, "composed");
}

export class NoAnswerModelError extends Error {
  constructor() {
    super("No answer model configured");
    this.name = "NoAnswerModelError";
  }
}

let client: OpenAI | null = null;
const openAiClient = (): OpenAI | null => {
  if (!env.openaiApiKey) return null;
  client ??= new OpenAI({ apiKey: env.openaiApiKey, timeout: 60_000, maxRetries: 1 });
  return client;
};

/** Real model port: JSON mode, temperature 0. No key => throws, which yields the insufficient reply. */
export const callAnswerModel = async (prompt: { system: string; user: string }): Promise<string> => {
  const openai = openAiClient();
  if (!openai) throw new NoAnswerModelError();
  const res = await openai.chat.completions.create({
    model: env.brainAnswerModel,
    temperature: 0,
    max_tokens: 900,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
};

/** Strict answering with the real ports (DB retrieval + OpenAI). */
export const answerGrounded = (p: GroundedInput): Promise<GroundedResult> => {
  if (!env.openaiApiKey) {
    // no model: never an ungrounded fallback, and no point retrieving
    return answerGroundedWith(
      { retrieve: async () => ({ evidence: [], guidance: [] }), callModel: callAnswerModel },
      p,
    );
  }
  return answerGroundedWith({ retrieve: (r, q) => retrieveEvidence(r, q), callModel: callAnswerModel }, p);
};
