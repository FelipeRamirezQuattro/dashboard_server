import OpenAI from "openai";
import { env } from "../../config/env";
import logger from "../../utils/logger";
import { recordBrainAudit } from "../brainAudit.service";
import type { BrainAuditAction } from "../brainAudit.service";
import { buildGroundedPrompt, composeAnswer, parseModelOutput, validateStatements } from "./grounding";
import { retrieveEvidence } from "./retrieval";
import type { Citation, Evidence } from "./types";

/*
 * Strict (grounded) Brain answers, contract A6 / plan R4:
 * retrieve -> fewer than minEvidenceCount items RETRIEVED => "not enough stored information" WITHOUT calling the
 * model (A6.4) -> model (JSON statements) -> parse -> validate every statement (citation must resolve, never guidance,
 * every number must be a stored token of the CITED text) -> compose (bullets + "Based on N stored records" +
 * citations; insufficient only when no statement survived, a single cited record is a valid answer).
 * Status: "answered" | "insufficient" (the data cannot support an answer) | "unavailable" (retrieval failed, the
 * provider failed, timed out or rejected the key, or the model output could not be parsed). Unavailable is never
 * reported as missing data and never writes BRAIN_ANSWER_INSUFFICIENT_EVIDENCE. Never a 500.
 *
 * Known design limit (not solved here): the number gate matches numbers token-by-token against ALL cited text, so a
 * stored number used for the wrong field ("ran 167 days" citing a row with max_stroke_in=167) is not caught.
 *
 * Logs and audit carry ids and counts only: never the question, evidence, prompt or answer.
 */

export type GroundedStatus = "answered" | "insufficient" | "unavailable";

export interface GroundedResult {
  reply: string;
  citations: Citation[];
  /** True only for status "insufficient" (kept for existing callers). */
  insufficient: boolean;
  usedCount: number;
  status: GroundedStatus;
}

export type GroundedAuditAction = Extract<BrainAuditAction, "BRAIN_ANSWER_INSUFFICIENT_EVIDENCE" | "BRAIN_ANSWER_UNAVAILABLE">;

export interface GroundedAuditMeta {
  categoryId: string;
  counts: number;
  action: GroundedAuditAction;
  /** Only for BRAIN_ANSWER_UNAVAILABLE: a fixed stage name (retrieve_error | model_error | not_configured). */
  stage?: string;
}

export interface GroundedPorts {
  retrieve(p: { categoryId: string }, question: string): Promise<{ evidence: Evidence[]; guidance: string[]; searched?: number }>;
  callModel(prompt: { system: string; user: string }): Promise<string>;
  /** Defaults to recordBrainAudit(meta.action) with ids/counts only. Must never break the answer. */
  audit?(meta: GroundedAuditMeta): Promise<void>;
}

export const UNAVAILABLE_REPLY = "The answer service is temporarily unavailable. Please try again in a moment.";
export const NOT_CONFIGURED_REPLY = "Stored records could not be searched: the answer service is not configured.";

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

const withStatus = (r: Omit<GroundedResult, "status">): GroundedResult => ({ ...r, status: r.insufficient ? "insufficient" : "answered" });
const insufficient = (evidence: Evidence[]): GroundedResult => withStatus(composeAnswer({ kept: [], evidence }));
const unavailable = (reply = UNAVAILABLE_REPLY): GroundedResult => ({ reply, citations: [], insufficient: false, usedCount: 0, status: "unavailable" });

/** The reply when no answer model is configured: explicit, never "not enough stored information", no search claim. */
export const notConfiguredResult = (): GroundedResult => unavailable(NOT_CONFIGURED_REPLY);

/** The insufficient reply reports how many stored items were searched (all candidates), not only those selected. */
const withSearched = (result: GroundedResult, selected: number, searched: number | undefined): GroundedResult =>
  result.insufficient && typeof searched === "number" && Number.isFinite(searched) && searched > selected
    ? { ...result, reply: result.reply.replace(`Searched: ${selected} stored records.`, `Searched: ${searched} stored records.`) }
    : result;

/** Pure orchestration over injected ports (fully fixturable). Never throws. */
export async function answerGroundedWith(ports: GroundedPorts, p: GroundedInput): Promise<GroundedResult> {
  const categoryId = String(p.category._id);
  const min = p.category.minEvidenceCount;
  const finish = async (result: GroundedResult, evidenceCount: number, stage: string): Promise<GroundedResult> => {
    logger.info(
      `[brain:grounded] categoryId=${categoryId} stage=${stage} evidence=${evidenceCount} used=${result.usedCount} status=${result.status}`,
    );
    if (result.status === "insufficient") {
      await auditGroundedAnswer(ports.audit, p.userId, { categoryId, counts: evidenceCount, action: "BRAIN_ANSWER_INSUFFICIENT_EVIDENCE" });
    } else if (result.status === "unavailable") {
      await auditGroundedAnswer(ports.audit, p.userId, { categoryId, counts: evidenceCount, action: "BRAIN_ANSWER_UNAVAILABLE", stage });
    }
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
    return finish(unavailable(), 0, "retrieve_error");
  }
  if (evidence.length < min || evidence.length === 0) {
    return finish(insufficient(evidence), evidence.length, "too_little_evidence");
  }

  const prompt = buildGroundedPrompt({ categoryName: p.category.name, question: p.question, evidence, guidance });
  let statements;
  try {
    const raw = await ports.callModel(prompt);
    statements = parseModelOutput(raw);
  } catch (e) {
    // GroundingError(BAD_MODEL_OUTPUT: non-JSON / truncated output), provider errors, timeouts, bad key: the model did
    // not produce a valid answer => unavailable (not "missing data"); never an ungrounded fallback
    logger.warn(`[brain:grounded] categoryId=${categoryId} model failed error=${e instanceof Error ? e.name : "Error"}`);
    return finish(unavailable(), evidence.length, "model_error");
  }
  const { kept, dropped } = validateStatements(statements, evidence);
  logger.info(`[brain:grounded] categoryId=${categoryId} statements=${statements.length} kept=${kept.length} dropped=${dropped.length}`);
  const result = withStatus(composeAnswer({ kept, evidence }));
  return finish(result, evidence.length, "composed");
}

/** Audit row with ids, counts and a fixed stage name only. Failures never break the answer. */
const auditGroundedAnswer = async (port: GroundedPorts["audit"], userId: string | undefined, meta: GroundedAuditMeta): Promise<void> => {
  try {
    if (port) {
      await port(meta);
      return;
    }
    await recordBrainAudit({
      userId,
      action: meta.action,
      target: "brain_chat",
      metadata: { categoryId: meta.categoryId, counts: meta.counts, ...(meta.stage ? { status: meta.stage } : {}) },
    });
  } catch {
    /* audit failures never break the answer */
  }
};

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

/** Real model port: JSON mode, temperature 0. No key => throws, which yields the unavailable reply. */
export const callAnswerModel = async (prompt: { system: string; user: string }): Promise<string> => {
  const openai = openAiClient();
  if (!openai) throw new NoAnswerModelError();
  const res = await openai.chat.completions.create({
    model: env.brainAnswerModel,
    temperature: 0,
    max_tokens: 1200,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: prompt.system },
      { role: "user", content: prompt.user },
    ],
  });
  return res.choices[0]?.message?.content ?? "";
};

/** Strict answering with the real ports (DB retrieval + OpenAI). */
export const answerGrounded = async (p: GroundedInput): Promise<GroundedResult> => {
  if (!env.openaiApiKey) {
    // no model: never an ungrounded fallback, and no point retrieving
    const categoryId = String(p.category._id);
    logger.info(`[brain:grounded] categoryId=${categoryId} stage=not_configured evidence=0 used=0 status=unavailable`);
    await auditGroundedAnswer(undefined, p.userId, { categoryId, counts: 0, action: "BRAIN_ANSWER_UNAVAILABLE", stage: "not_configured" });
    return notConfiguredResult();
  }
  return answerGroundedWith({ retrieve: (r, q) => retrieveEvidence(r, q), callModel: callAnswerModel }, p);
};
