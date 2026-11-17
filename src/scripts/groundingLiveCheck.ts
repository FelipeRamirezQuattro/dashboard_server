/// <reference types="node" />
/*
 * Grounding evaluation harness (plan R4 / contract A6, B9): runs a question set through the REAL pure retrieval and the
 * REAL grounded-answer orchestration over IN-MEMORY active records built from the fictional Rod Pump sample CSVs.
 * No database, no server.
 *
 *   npm run brain:grounding-dry    deterministic fake embeddings + fake model: validates the HARNESS only (not quality)
 *   npm run brain:grounding-live   real embeddings + the real OpenAI answer model (needs OPENAI_API_KEY in server/.env)
 *
 * Exit code 1 when any case fails or any invented number is found (demo gate: 0 invented values).
 * Output is stdout only and prints ids, counts and replies about the FICTIONAL sample data; never env values.
 * The independent checks below (number tokens, reply grammar, citation resolution) deliberately do NOT use the
 * internals of grounding.ts so a bug in the server's gate is caught here.
 */
import fs from "fs";
import path from "path";
import { env } from "../config/env";
import logger from "../utils/logger";
import { embedInBatches, getEmbeddingProvider } from "../services/brain/embeddingProvider";
import type { EmbeddingProvider } from "../services/brain/embeddingProvider";
import { answerGroundedWith, callAnswerModel } from "../services/brain/groundedAnswer.service";
import type { GroundedResult } from "../services/brain/groundedAnswer.service";
import { retrieveEvidence } from "../services/brain/retrieval";
import type { RecordLite, RetrievalPorts } from "../services/brain/retrieval";
import { tokensFor } from "../services/brain/text";
import type { Evidence } from "../services/brain/types";
import { fakePorts, sampleRecords } from "../tests/brain/sampleData";

// The server logs ids/counts only, but the harness keeps stdout (the table) and logs/ files clean.
logger.silent = true;

export type GroundingCategory = "answerable" | "unanswerable" | "offtopic" | "injection" | "numeric" | "minEvidence";

export interface GroundingCase {
  id: string;
  question: string;
  answerable: boolean;
  category: GroundingCategory;
  mustCite?: string[];
  mustContain?: string[];
  mustNotContain?: string[];
  /** Per-case override of the category's minimum evidence count. */
  minEvidenceCount?: number;
  /** answerable:true cases where a refusal (insufficient reply) is also acceptable, e.g. derived-number traps. */
  mayRefuse?: boolean;
  note?: string;
}

export interface CaseVerdict {
  id: string;
  category: GroundingCategory;
  verdict: "PASS" | "FAIL";
  failures: string[];
  evidenceCount: number;
  citedCount: number;
  modelCalled: boolean;
  insufficient: boolean;
  invalidNumbers: number;
  reply: string;
  note: string;
}

export interface GroundingReport {
  verdicts: CaseVerdict[];
  total: number;
  passed: number;
  failed: number;
  invalidNumbersTotal: number;
  modelCalls: number;
  ok: boolean;
}

export interface GroundingPorts {
  retrieval: RetrievalPorts;
  callModel(prompt: { system: string; user: string }): Promise<string>;
  /** Relevance floor passed to retrieval; defaults to BRAIN_MIN_SCORE. */
  minScore?: number;
  /** Test seam: replaces answerGroundedWith so fixtures can simulate a buggy gate. Never set by the CLI. */
  answer?: typeof answerGroundedWith;
}

// ---------------------------------------------------------------- independent checks

const NUMBER_RE = /\d+(?:[.,]\d+)*/g;

/** Own normalisation: no thousands commas, no leading zeros, no trailing decimal zeros. */
const normNumber = (raw: string): string => {
  const [i, d = ""] = raw.replace(/,/g, "").split(".");
  const int = i.replace(/^0+(?=\d)/, "") || "0";
  const dec = d.replace(/0+$/, "");
  return dec ? `${int}.${dec}` : int;
};
const numberTokens = (text: string): string[] => (text.match(NUMBER_RE) ?? []).map(normNumber);

const INSUFFICIENT_LINES = [
  /^Not enough stored information to answer this\.$/,
  /^Searched: \d+ stored records\.$/,
  /^Adding more historical data for this topic would help\.$/,
];
const DRAFT_TEXT = "DRAFT — suggestions only; an engineer must review.";

type ParsedReply =
  | { kind: "insufficient" }
  | { kind: "answer"; bullets: { text: string; markers: number[] }[]; basedOn: number }
  | { kind: "invalid"; why: string };

/** The server's reply grammar: bullets "- text [n] [m]", blank line, "Based on N stored records.", optional DRAFT line. */
export const parseReplyGrammar = (reply: string): ParsedReply => {
  const lines = reply.split("\n");
  if (lines.length === 3 && INSUFFICIENT_LINES.every((re, i) => re.test(lines[i]))) return { kind: "insufficient" };
  const blank = lines.indexOf("");
  if (blank < 1) return { kind: "invalid", why: "no bullet block" };
  const tail = lines.slice(blank + 1);
  const based = /^Based on (\d+) stored records\.$/.exec(tail[0] ?? "");
  if (!based) return { kind: "invalid", why: "missing 'Based on N stored records.' line" };
  if (!(tail.length === 1 || (tail.length === 2 && tail[1] === DRAFT_TEXT))) return { kind: "invalid", why: "unexpected trailing text" };
  const bullets: { text: string; markers: number[] }[] = [];
  for (const line of lines.slice(0, blank)) {
    const m = /^- (.+?)((?: \[\d+\])*)$/.exec(line);
    if (!m) return { kind: "invalid", why: "line outside the bullet grammar" };
    bullets.push({ text: m[1], markers: Array.from(m[2].matchAll(/\[(\d+)\]/g), (x) => Number(x[1])) });
  }
  return { kind: "answer", bullets, basedOn: Number(based[1]) };
};

/**
 * Evaluates one result. `meta.modelCalls` is how many times the model port was invoked for this case.
 * Number check: every number token of every bullet must appear among the number tokens of the rows THAT bullet cites.
 */
export const evaluateCase = (
  c: GroundingCase,
  result: GroundedResult,
  evidence: Evidence[],
  meta: { modelCalls: number; minEvidenceCount: number } = { modelCalls: 0, minEvidenceCount: 2 },
): CaseVerdict => {
  const failures: string[] = [];
  const byId = new Map(evidence.map((e) => [e.id, e]));
  const citedIds = result.citations.map((x) => x.id);
  let invalidNumbers = 0;

  if (evidence.length < meta.minEvidenceCount && meta.modelCalls > 0) {
    failures.push(`model called with ${evidence.length} evidence item(s) < min ${meta.minEvidenceCount}`);
  }
  for (const id of citedIds) if (!byId.has(id)) failures.push(`cited id not in retrieved evidence: ${id}`);

  const parsed = parseReplyGrammar(result.reply);
  if (parsed.kind === "invalid") failures.push(`reply outside grammar: ${parsed.why}`);
  if (parsed.kind === "insufficient" && !result.insufficient) failures.push("insufficient text but result.insufficient=false");
  if (parsed.kind === "answer") {
    if (result.insufficient) failures.push("answer text but result.insufficient=true");
    if (parsed.basedOn !== citedIds.length) failures.push(`'Based on ${parsed.basedOn}' but ${citedIds.length} citations`);
    for (const b of parsed.bullets) {
      if (!b.markers.length) failures.push("bullet without citation marker");
      const rows = b.markers.map((n) => citedIds[n - 1]).map((id) => (id === undefined ? undefined : byId.get(id)));
      if (rows.some((r) => r === undefined)) {
        failures.push("citation marker does not resolve to a retrieved row");
        continue;
      }
      const stored = new Set(rows.flatMap((r) => numberTokens(r!.text)));
      for (const n of numberTokens(b.text)) {
        if (!stored.has(n)) {
          invalidNumbers += 1;
          failures.push(`number ${n} not in cited rows`);
        }
      }
    }
  }

  const reply = result.reply.toLowerCase();
  for (const s of c.mustNotContain ?? []) if (reply.includes(s.toLowerCase())) failures.push(`contains forbidden "${s}"`);
  if (c.answerable && c.mayRefuse && result.insufficient) {
    // a refusal is an accepted outcome for this case
  } else if (c.answerable) {
    if (result.insufficient) failures.push("answerable case returned the insufficient reply");
    for (const p of c.mustCite ?? []) if (!citedIds.some((id) => id.startsWith(p))) failures.push(`missing citation ${p}`);
    for (const s of c.mustContain ?? []) if (!reply.includes(s.toLowerCase())) failures.push(`missing "${s}"`);
  } else if (!result.insufficient) {
    failures.push("non-answerable case returned a non-insufficient reply");
  }

  return {
    id: c.id,
    category: c.category,
    verdict: failures.length ? "FAIL" : "PASS",
    failures,
    evidenceCount: evidence.length,
    citedCount: citedIds.length,
    modelCalled: meta.modelCalls > 0,
    insufficient: result.insufficient,
    invalidNumbers,
    reply: result.reply,
    note: c.note ?? "",
  };
};

export const runGroundingSet = async (p: {
  set: GroundingCase[];
  ports: GroundingPorts;
  minEvidenceCount: number;
}): Promise<GroundingReport> => {
  const verdicts: CaseVerdict[] = [];
  let modelCalls = 0;
  for (const c of p.set) {
    const min = c.minEvidenceCount ?? p.minEvidenceCount;
    let calls = 0;
    let retrieved: Evidence[] = [];
    const result = await (p.ports.answer ?? answerGroundedWith)(
      {
        retrieve: async (r, q) => {
          const out = await retrieveEvidence({ ...r, minScore: p.ports.minScore }, q, p.ports.retrieval);
          retrieved = out.evidence;
          return out;
        },
        callModel: async (prompt) => {
          calls += 1;
          return p.ports.callModel(prompt);
        },
        audit: async () => undefined,
      },
      { category: { _id: "507f1f77bcf86cd799439011", name: "Rod Pump Failure", minEvidenceCount: min }, question: c.question },
    );
    modelCalls += calls;
    verdicts.push(evaluateCase(c, result, retrieved, { modelCalls: calls, minEvidenceCount: min }));
  }
  const failed = verdicts.filter((v) => v.verdict === "FAIL").length;
  const invalidNumbersTotal = verdicts.reduce((n, v) => n + v.invalidNumbers, 0);
  return {
    verdicts,
    total: verdicts.length,
    passed: verdicts.length - failed,
    failed,
    invalidNumbersTotal,
    modelCalls,
    ok: failed === 0 && invalidNumbersTotal === 0,
  };
};

// ---------------------------------------------------------------- dry mode (deterministic, offline)

const DRY_DIM = 256;
const hashToken = (t: string): number => {
  let h = 2166136261;
  for (let i = 0; i < t.length; i += 1) h = Math.imul(h ^ t.charCodeAt(i), 16777619);
  return (h >>> 0) % DRY_DIM;
};
/** Hashed bag-of-content-tokens vector. Deterministic, no network. */
export const dryEmbed = (text: string): number[] => {
  const v = new Array<number>(DRY_DIM).fill(0);
  for (const t of tokensFor(text)) v[hashToken(t)] += 1;
  return v.some((x) => x !== 0) ? v : (v[0] = 1, v);
};
export const dryEmbeddingProvider: EmbeddingProvider = {
  model: "dry-hash",
  version: "1",
  embed: async (texts) => texts.map(dryEmbed),
};

const unescapeXml = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
const FILLERS = new Set([
  "many", "much", "did", "does", "was", "were", "had", "has", "have", "been", "than", "more", "which", "with", "there",
  "that", "this", "those", "seen", "after", "before", "into", "about", "any", "recorded", "stored", "kind", "list", "tell",
  "taken", "composition", "action",
]);

/**
 * Deterministic rule-based fake model (DRY MODE ONLY: it validates the harness, it says nothing about model quality).
 * It refuses ({"statements":[]}) when the question has a content word that appears in none of the evidence it was given
 * (so "tires", "boiler", "ignore" => refuse), otherwise it cites the evidence rows that share words with the question,
 * quoting each row verbatim.
 */
export const dryModel = async (prompt: { system: string; user: string }): Promise<string> => {
  const q = unescapeXml(/<question>([\s\S]*?)<\/question>/.exec(prompt.user)?.[1] ?? "");
  const rows = Array.from(prompt.user.matchAll(/<evidence id="([^"]*)">([\s\S]*?)<\/evidence>/g), (m) => ({
    id: unescapeXml(m[1]),
    text: unescapeXml(m[2]),
  }));
  const evidenceTokens = new Set(rows.flatMap((r) => tokensFor(r.text)));
  const keys = new Set(rows.flatMap((r) => r.text.match(/DEMO-\d+/g) ?? []).map((k) => k.toLowerCase()));
  const qKeys = (q.match(/[A-Za-z]+-\d+/g) ?? []).map((k) => k.toLowerCase());
  const keyParts = new Set(qKeys.flatMap((k) => k.split("-")));
  const qTokens = tokensFor(q).filter((t) => !keyParts.has(t));
  const plural = (t: string): string => t.slice(0, 4); // 4-char stem: "pulled"~"pull_date", but "fits"!~"fit"
  const known = new Set(Array.from(evidenceTokens, plural));
  const unmatched = qTokens.filter((t) => !FILLERS.has(t) && !known.has(plural(t)));
  if (unmatched.length || (qKeys.length && !qKeys.some((k) => keys.has(k)))) return JSON.stringify({ statements: [] });
  const scored = rows
    .map((r) => {
      const own = new Set(Array.from(tokensFor(r.text), plural));
      return { r, n: qTokens.filter((t) => own.has(plural(t))).length };
    })
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const named = rows.filter((r) => qKeys.some((k) => r.id.toLowerCase().endsWith(`/${k}`)));
  const ordered = [...named, ...scored.map((x) => x.r), ...rows.slice(0, 3)]; // padded: a lone row can never meet minEvidenceCount
  const pick = ordered.filter((r, i) => ordered.indexOf(r) === i).slice(0, Math.max(5, named.length));
  return JSON.stringify({ statements: pick.map((r) => ({ text: r.text, citations: [r.id] })) });
};

// ---------------------------------------------------------------- port construction (in-memory active records)

const withVectors = async (records: RecordLite[], provider: EmbeddingProvider): Promise<RecordLite[]> => {
  const roots = records.filter((r) => typeof r.cardText === "string" && r.cardText);
  const vectors = await embedInBatches(provider, roots.map((r) => r.cardText as string));
  const byKey = new Map(roots.map((r, i) => [`${r.table}\u0000${r.primaryKeyValue}`, vectors[i]]));
  return records.map((r) => {
    const v = byKey.get(`${r.table}\u0000${r.primaryKeyValue}`);
    return v ? { ...r, embedding: v, embeddingModel: provider.model, embeddingVersion: provider.version } : r;
  });
};

export const buildInMemoryRetrievalPorts = async (provider: EmbeddingProvider | null): Promise<RetrievalPorts> => {
  const base = sampleRecords();
  const records = provider ? await withVectors(base, provider) : base;
  const ports = fakePorts({
    records,
    identity: provider ? { model: provider.model, version: provider.version } : null,
    embed: provider ? async (q) => (await embedInBatches(provider, [q], 1))[0] ?? null : undefined,
  });
  return ports;
};

export const loadSet = (file = path.resolve(__dirname, "../tests/brain/groundingSet.json")): GroundingCase[] =>
  JSON.parse(fs.readFileSync(file, "utf8")) as GroundingCase[];

// ---------------------------------------------------------------- CLI

const pad = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));

export const formatReport = (r: GroundingReport): string => {
  const out: string[] = [];
  out.push([pad("id", 22), pad("category", 13), pad("verdict", 7), pad("evid", 5), pad("cited", 6), pad("model", 6), "note"].join(" "));
  for (const v of r.verdicts) {
    out.push(
      [pad(v.id, 22), pad(v.category, 13), pad(v.verdict, 7), pad(String(v.evidenceCount), 5), pad(String(v.citedCount), 6), pad(v.modelCalled ? "yes" : "no", 6), v.failures.length ? v.failures.join(" | ") : v.note].join(" "),
    );
  }
  out.push("");
  out.push(
    `cases=${r.total} passed=${r.passed} failed=${r.failed} invalidNumbersTotal=${r.invalidNumbersTotal} modelCalls=${r.modelCalls}`,
  );
  out.push(r.ok ? "RESULT: OK (0 invented values)" : "RESULT: FAIL");
  return out.join("\n");
};

const main = async (): Promise<number> => {
  const dry = process.argv.includes("--dry");
  const verbose = process.argv.includes("--verbose");
  let provider: EmbeddingProvider | null;
  let callModel: GroundingPorts["callModel"];
  if (dry) {
    provider = dryEmbeddingProvider;
    callModel = dryModel;
    console.log("MODE: dry (fake embeddings + fake model). Validates the harness only, NOT model quality.");
  } else {
    if (!env.openaiApiKey) {
      console.error("Live mode needs OPENAI_API_KEY in server/.env (not set). Use --dry for the offline harness check.");
      return 2;
    }
    provider = getEmbeddingProvider();
    callModel = callAnswerModel;
    console.log(`MODE: live (real embeddings + real answer model). BRAIN_MIN_SCORE=${env.brainMinScore}`);
  }
  const report = await runGroundingSet({
    set: loadSet(),
    ports: { retrieval: await buildInMemoryRetrievalPorts(provider), callModel },
    minEvidenceCount: 2,
  });
  console.log(formatReport(report));
  if (verbose) for (const v of report.verdicts) console.log(`\n[${v.id}]\n${v.reply}`);
  else for (const v of report.verdicts.filter((x) => x.verdict === "FAIL")) console.log(`\n[${v.id}] reply:\n${v.reply}`);
  return report.ok ? 0 : 1;
};

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`grounding check failed: ${e instanceof Error ? e.name : "Error"}`);
      process.exit(1);
    });
}
