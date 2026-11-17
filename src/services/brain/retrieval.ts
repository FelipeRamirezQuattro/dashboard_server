import mongoose from "mongoose";
import { BrainDatasetDefinitionRecord, BrainDatasetRecord, BrainDocument } from "../../models/BrainKnowledge.model";
import { BrainMemory } from "../../models/WorkflowBrain.model";
import { builtinDefinitions } from "./datasets.service";
import { embedInBatches, getEmbeddingProvider } from "./embeddingProvider";
import { buildChunkEmbeddingText, selectActiveRecords } from "./indexerCore";
import { buildRecordCards, primaryKeyValueOf } from "./recordCards";
import type { DatasetDefinition, Evidence } from "./types";
import { keywordRank, rankByCosine, rrfMerge } from "./vector";

/*
 * Hybrid retrieval for strict (grounded) Brain answers (contract A6a).
 * - Only ACTIVE documents' chunks and ACTIVE dataset records are ever candidates. The parent status is checked here,
 *   on every call: a vector stored on a chunk of an archived/draft document or on a superseded/rolled-back record is
 *   never trusted as a reason to include it.
 * - Dataset evidence is rebuilt from the active records (buildRecordCards); stored cardText is never evidence. Each
 *   card contributes its ROW-level evidence items; a vector hit on a card expands to its rows (root first).
 * - Guidance chunks are never evidence: they only feed the prompt's guidance list (A3).
 * - Embeddings only find candidates. Any embedding failure, a missing provider or missing/mismatched vectors fall
 *   back to keyword-only ranking without an error.
 * - Nothing here logs content (questions, chunk text, rows, vectors).
 */

export const DEFAULT_EVIDENCE_LIMIT = 40;
export const MAX_VECTORS_PER_CATEGORY = 20_000;
export const MAX_GUIDANCE_CHUNKS = 5;
export const MAX_GUIDANCE_CHARS = 500;
const VECTOR_TOP_K = 40;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Case-insensitive whole-token match of known keys in the question (DEMO-001 matches "demo-001", not "DEMO-0011"). */
export function findNamedKeys(question: string, keys: string[]): string[] {
  const q = typeof question === "string" ? question : "";
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (typeof key !== "string") continue;
    const k = key.trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(k)}(?![\\p{L}\\p{N}])`, "iu");
    if (re.test(q)) {
      seen.add(k.toLowerCase());
      out.push(k);
    }
  }
  return out;
}

/**
 * True when the evidence id's primary-key part (after "ds:{dataset}/{table}/"), or one of its "|"-separated parts,
 * equals the key exactly (case-insensitive). Chunk ids never match.
 */
export function evidenceIdMatchesKey(id: string, key: string): boolean {
  if (!id.startsWith("ds:") || !key) return false;
  const parts = id.slice(3).split("/");
  if (parts.length < 3) return false;
  const pk = parts.slice(2).join("/");
  const k = key.toLowerCase();
  return pk.toLowerCase() === k || pk.split("|").some((p) => p.toLowerCase() === k);
}

const dedupeById = (items: Evidence[]): Evidence[] => {
  const seen = new Set<string>();
  const out: Evidence[] = [];
  for (const e of items) {
    if (!e || typeof e.id !== "string" || seen.has(e.id)) continue; // first wins; duplicates can never shadow
    seen.add(e.id);
    out.push(e);
  }
  return out;
};

/**
 * Pure selection: dedupe by id, keyword-rank the candidates, fuse with vector ranks (RRF), always keep candidates
 * that belong to a named key (or are listed in namedIds), drop candidates with neither keyword overlap nor a vector
 * rank, never return guidance, cap at limit (named first). Each item's score is its fused RRF score.
 */
export function selectEvidence(p: {
  question: string;
  candidates: Evidence[];
  vectorRanks?: string[];
  namedKeys: string[];
  /** Ids that belong to a named key through a card (e.g. component rows of a named case). */
  namedIds?: string[];
  limit?: number;
}): Evidence[] {
  const limit = Math.max(0, Math.floor(p.limit ?? DEFAULT_EVIDENCE_LIMIT));
  const candidates = dedupeById(p.candidates).filter((e) => !e.isGuidance);
  const byId = new Map(candidates.map((e) => [e.id, e]));
  // named keys are matched structurally; their tokens ("demo", "001") would keyword-match every row of every case
  const keywordQuestion = p.namedKeys.reduce(
    (q, k) => (k.trim() ? q.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(k.trim())}(?![\\p{L}\\p{N}])`, "giu"), " ") : q),
    p.question,
  );
  const keyword = keywordRank(keywordQuestion, candidates.map((e) => ({ id: e.id, text: `${e.label}\n${e.text}` })));
  const vector = (p.vectorRanks ?? []).filter((id) => byId.has(id));
  const fused = rrfMerge(vector.length ? [keyword, vector] : [keyword]);
  const score = new Map(fused.map((s) => [s.id, s.score]));
  const namedIdSet = new Set(p.namedIds ?? []);
  // a row belongs to a named key by its id; a document chunk when its text names the key
  const isNamed = (e: Evidence): boolean =>
    namedIdSet.has(e.id) ||
    p.namedKeys.some((k) => evidenceIdMatchesKey(e.id, k)) ||
    (e.kind === "chunk" && p.namedKeys.length > 0 && findNamedKeys(`${e.label}\n${e.text}`, p.namedKeys).length > 0);
  const order = (a: Evidence, b: Evidence): number =>
    (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const named = candidates.filter(isNamed).sort(order);
  const namedSet = new Set(named.map((e) => e.id));
  const ranked = fused.map((s) => byId.get(s.id)!).filter((e) => e && !namedSet.has(e.id));
  return [...named, ...ranked].slice(0, limit).map((e) => ({ ...e, score: score.get(e.id) ?? 0 }));
}

type Row = Record<string, unknown>;

/**
 * Row-level evidence rebuilt from ACTIVE records, plus card primaryKeyValue -> evidence ids (root first).
 * Tables that reference the card root but are not in card.include (e.g. evidence file links) are attached to their
 * card here too, so they can be cited; the embedded card text itself is unchanged.
 */
export function buildDatasetCandidates(
  def: DatasetDefinition,
  activeRecords: { table: string; data: Row }[],
): { evidence: Evidence[]; cardToEvidenceIds: Map<string, string[]> } {
  const rows: Record<string, Row[]> = {};
  for (const r of activeRecords) (rows[r.table] ??= []).push(r.data);
  const dataById = new Map<string, Row>();
  for (const t of def.tables) {
    for (const row of rows[t.name] ?? []) {
      dataById.set(`ds:${def.key}/${t.name}/${primaryKeyValueOf(t, row)}`, row);
    }
  }
  const evidence: Evidence[] = [];
  const seen = new Set<string>();
  const cardToEvidenceIds = new Map<string, string[]>();
  const root = def.card?.rootTable;
  const extra = def.tables
    .filter((t) => root && t.name !== root && !def.card!.include.includes(t.name) && t.references.some((r) => r.table === root))
    .map((t) => t.name);
  const evidenceDef: DatasetDefinition = def.card && extra.length
    ? { ...def, card: { ...def.card, include: [...def.card.include, ...extra] } }
    : def;
  for (const card of buildRecordCards(evidenceDef, rows)) {
    const ids: string[] = [];
    for (const re of card.rowEvidence) {
      ids.push(re.id);
      if (seen.has(re.id)) continue;
      seen.add(re.id);
      const pk = re.id.slice(`ds:${def.key}/${re.table}/`.length);
      const data = dataById.get(re.id);
      const fileName = data && typeof data.file_name === "string" && data.file_name.trim() ? data.file_name.trim() : undefined;
      const page = fileName && typeof data?.page === "number" && Number.isFinite(data.page) ? data.page : undefined;
      evidence.push({
        id: re.id,
        kind: "row",
        text: re.text,
        label: `${re.table} ${pk}`,
        ...(fileName ? { fileName } : {}),
        ...(page !== undefined ? { page } : {}),
        score: 0,
        isGuidance: false,
      });
    }
    cardToEvidenceIds.set(card.primaryKeyValue, ids);
  }
  return { evidence, cardToEvidenceIds };
}

export interface DocumentLite {
  _id: unknown;
  title: string;
  kind: string;
  status: string;
  sourceFormat?: string;
}
export interface ChunkLite {
  _id?: unknown;
  documentId: unknown;
  chunkIndex: number;
  heading?: string | null;
  page?: number | null;
  content: string;
  embedding?: number[] | null;
  embeddingModel?: string | null;
  embeddingVersion?: string | null;
  createdAt?: Date | string | null;
}

export const chunkEvidenceId = (documentId: unknown, chunkIndex: number): string => `doc:${String(documentId)}#${chunkIndex}`;

const truncate = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/**
 * Chunks of ACTIVE documents only. Non-guidance chunks become evidence (id doc:{documentId}#{chunkIndex}); guidance
 * chunks never become evidence and go to the guidance list (<= 5, each <= 500 chars, keyword-relevant first, then in
 * document order).
 */
export function buildChunkCandidates(
  documents: DocumentLite[],
  chunks: ChunkLite[],
  question = "",
): { evidence: Evidence[]; guidance: string[] } {
  const active = new Map<string, DocumentLite>();
  for (const d of documents) if (d && d.status === "active") active.set(String(d._id), d);
  const ordered = chunks
    .filter((c) => c && active.has(String(c.documentId)) && typeof c.content === "string")
    .sort((a, b) => (String(a.documentId) < String(b.documentId) ? -1 : String(a.documentId) > String(b.documentId) ? 1 : a.chunkIndex - b.chunkIndex));
  const evidence: Evidence[] = [];
  const guidanceChunks: { id: string; text: string }[] = [];
  const seen = new Set<string>();
  for (const c of ordered) {
    const doc = active.get(String(c.documentId))!;
    const id = chunkEvidenceId(c.documentId, c.chunkIndex);
    if (seen.has(id)) continue;
    seen.add(id);
    if (doc.kind === "guidance") {
      guidanceChunks.push({ id, text: c.content });
      continue;
    }
    const heading = c.heading && c.heading.trim() ? c.heading.trim() : "";
    const isPdf = doc.sourceFormat === "pdf" && typeof c.page === "number";
    const label = `${doc.title}${heading ? ` — ${heading}` : ""}${isPdf ? ` p.${c.page}` : ""}`;
    evidence.push({
      id,
      kind: "chunk",
      text: buildChunkEmbeddingText(heading, c.content),
      label,
      ...(isPdf ? { page: c.page as number } : {}),
      score: 0,
      isGuidance: false,
    });
  }
  const relevant = keywordRank(question, guidanceChunks);
  const pickedIds = [...relevant, ...guidanceChunks.map((g) => g.id).filter((id) => !relevant.includes(id))].slice(0, MAX_GUIDANCE_CHUNKS);
  const byId = new Map(guidanceChunks.map((g) => [g.id, g.text]));
  return { evidence, guidance: pickedIds.map((id) => truncate(byId.get(id)!, MAX_GUIDANCE_CHARS)) };
}

export interface RecordLite {
  datasetKey: string;
  table: string;
  primaryKeyValue: string;
  data: Row;
  status: string;
  cardText?: string | null;
  embedding?: number[] | null;
  embeddingModel?: string | null;
  embeddingVersion?: string | null;
  updatedAt?: Date | string | null;
}

export interface RetrievalPorts {
  loadActiveDocuments(categoryId: string): Promise<DocumentLite[]>;
  /** Chunks of the given documents WITH embeddings (most recent first, at most MAX_VECTORS_PER_CATEGORY). */
  loadChunks(documentIds: string[]): Promise<ChunkLite[]>;
  /** Active records of every table, root records with their card embeddings. */
  loadActiveRecords(categoryId: string): Promise<RecordLite[]>;
  loadDefinitions(categoryId: string, datasetKeys: string[]): Promise<DatasetDefinition[]>;
  /** Current provider identity; null when no provider exists. */
  embeddingIdentity(): { model: string; version: string } | null;
  embedQuestion(question: string): Promise<number[] | null>;
}

const validVector = (v: unknown): v is number[] =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "number" && Number.isFinite(x));
const time = (d: Date | string | null | undefined): number => {
  const t = d ? new Date(d).getTime() : 0;
  return Number.isFinite(t) ? t : 0;
};

/** Identifier-like key parts (letter + digit) of active records, plus every root card key. */
const namedKeyUniverse = (records: RecordLite[], roots: Iterable<string>): string[] => {
  const keys = new Set<string>(roots);
  for (const r of records) {
    for (const part of String(r.primaryKeyValue).split("|")) {
      if (/\p{L}/u.test(part) && /\d/.test(part)) keys.add(part);
    }
  }
  return Array.from(keys);
};

/** Key shapes (DEMO-001 => /^demo-\d+$/i) used to spot a question about an id that was never imported. */
const keyShapes = (keys: string[]): RegExp[] => {
  const shapes = new Set<string>();
  for (const k of keys) {
    if (!/\d/.test(k) || !/\p{L}/u.test(k)) continue;
    shapes.add(k.split(/\d+/).map(escapeRegExp).join("\\d+"));
  }
  return Array.from(shapes).map((s) => new RegExp(`^${s}$`, "iu"));
};

/** Tokens of the question that look like a known key (same shape) but match no stored key. */
export function findUnknownKeyLikeTokens(question: string, keys: string[]): string[] {
  const shapes = keyShapes(keys);
  if (!shapes.length) return [];
  const known = new Set(keys.map((k) => k.toLowerCase()));
  const tokens = (question.match(/[\p{L}\p{N}][\p{L}\p{N}_-]*[\p{L}\p{N}]|[\p{L}\p{N}]/gu) ?? []).slice(0, 200);
  return tokens.filter((t) => !known.has(t.toLowerCase()) && shapes.some((re) => re.test(t)));
}

/**
 * Loads, filters (active parents only), ranks and selects evidence for one category. Never throws for embedding
 * problems (keyword-only). `searched` = candidate evidence items considered.
 *
 * Structured filter (A6a.1 / B9): when the question names an id shaped like a stored key that does not exist
 * (DEMO-999) and names no stored key, nothing is returned, so the answer is "not enough stored information".
 */
export async function retrieveEvidence(
  p: { categoryId: string },
  question: string,
  ports: RetrievalPorts = defaultRetrievalPorts,
): Promise<{ evidence: Evidence[]; guidance: string[]; searched: number }> {
  const documents = (await ports.loadActiveDocuments(p.categoryId)).filter((d) => d && d.status === "active");
  const activeDocIds = new Set(documents.map((d) => String(d._id)));
  const chunks = activeDocIds.size
    ? (await ports.loadChunks(Array.from(activeDocIds))).filter((c) => c && activeDocIds.has(String(c.documentId)))
    : [];
  const chunkSet = buildChunkCandidates(documents, chunks, question);

  const records = selectActiveRecords(await ports.loadActiveRecords(p.categoryId));
  const datasetKeys = Array.from(new Set(records.map((r) => r.datasetKey)));
  const defs = datasetKeys.length ? await ports.loadDefinitions(p.categoryId, datasetKeys) : [];
  const rowEvidence: Evidence[] = [];
  const cardRows = new Map<string, string[]>(); // `${datasetKey}\u0000${pk}` -> row evidence ids
  const rootKeys: string[] = [];
  const rootVectors: { key: string; record: RecordLite }[] = [];
  for (const def of defs) {
    const mine = records.filter((r) => r.datasetKey === def.key);
    const built = buildDatasetCandidates(def, mine);
    rowEvidence.push(...built.evidence);
    for (const [pk, ids] of built.cardToEvidenceIds) {
      cardRows.set(`${def.key}\u0000${pk}`, ids);
      rootKeys.push(pk);
    }
    const rootTable = def.card?.rootTable;
    if (!rootTable) continue;
    const cardText = new Map(buildRecordCards(def, groupRows(mine)).map((c) => [c.primaryKeyValue, c.text]));
    for (const r of mine) {
      if (r.table !== rootTable) continue;
      // a vector made for a different card text is stale: never used for ranking
      if (r.cardText !== cardText.get(r.primaryKeyValue)) continue;
      rootVectors.push({ key: `${def.key}\u0000${r.primaryKeyValue}`, record: r });
    }
  }

  const candidates = [...rowEvidence, ...chunkSet.evidence];
  const searched = candidates.length;
  const keys = namedKeyUniverse(records, rootKeys);
  const namedKeys = findNamedKeys(question, keys);
  if (!namedKeys.length && findUnknownKeyLikeTokens(question, keys).length) {
    return { evidence: [], guidance: chunkSet.guidance, searched };
  }
  const namedIds: string[] = [];
  for (const [k, ids] of cardRows) {
    const pk = k.slice(k.indexOf("\u0000") + 1);
    if (namedKeys.some((n) => n.toLowerCase() === pk.toLowerCase())) namedIds.push(...ids);
  }

  const vectorRanks = await rankByVectors(question, ports, chunks, rootVectors, cardRows);
  const evidence = selectEvidence({ question, candidates, vectorRanks, namedKeys, namedIds });
  return { evidence, guidance: chunkSet.guidance, searched };
}

const groupRows = (records: { table: string; data: Row }[]): Record<string, Row[]> => {
  const rows: Record<string, Row[]> = {};
  for (const r of records) (rows[r.table] ??= []).push(r.data);
  return rows;
};

/** Vector ranking over current-model vectors only (cap MAX_VECTORS_PER_CATEGORY, most recent kept). */
async function rankByVectors(
  question: string,
  ports: RetrievalPorts,
  chunks: ChunkLite[],
  roots: { key: string; record: RecordLite }[],
  cardRows: Map<string, string[]>,
): Promise<string[] | undefined> {
  try {
    const identity = ports.embeddingIdentity();
    if (!identity) return undefined;
    const current = (x: { embedding?: unknown; embeddingModel?: string | null; embeddingVersion?: string | null }): boolean =>
      validVector(x.embedding) && x.embeddingModel === identity.model && x.embeddingVersion === identity.version;
    const items: { id: string; vector: number[]; at: number }[] = [];
    for (const c of chunks) {
      if (current(c)) items.push({ id: chunkEvidenceId(c.documentId, c.chunkIndex), vector: c.embedding as number[], at: time(c.createdAt) });
    }
    for (const r of roots) {
      if (current(r.record)) items.push({ id: `card:${r.key}`, vector: r.record.embedding as number[], at: time(r.record.updatedAt) });
    }
    if (!items.length) return undefined;
    const capped = items.length > MAX_VECTORS_PER_CATEGORY
      ? [...items].sort((a, b) => b.at - a.at).slice(0, MAX_VECTORS_PER_CATEGORY)
      : items;
    const query = await ports.embedQuestion(question);
    if (!validVector(query)) return undefined;
    const ranked = rankByCosine(query, capped, VECTOR_TOP_K);
    const out: string[] = [];
    for (const r of ranked) {
      if (r.id.startsWith("card:")) out.push(...(cardRows.get(r.id.slice(5)) ?? []));
      else out.push(r.id);
    }
    return out;
  } catch {
    return undefined; // keyword-only; never log content
  }
}

const oid = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id);

/** Real ports: the category's ACTIVE documents/records (parents re-checked in retrieveEvidence) and the provider. */
export const defaultRetrievalPorts: RetrievalPorts = {
  async loadActiveDocuments(categoryId) {
    const docs = await BrainDocument.find({ categoryId: oid(categoryId), status: "active" })
      .select("_id title kind status sourceFormat")
      .lean();
    return docs as unknown as DocumentLite[];
  },
  async loadChunks(documentIds) {
    if (!documentIds.length) return [];
    const chunks = await BrainMemory.find({ type: "document_chunk", documentId: { $in: documentIds.map(oid) } })
      .select("+embedding documentId chunkIndex heading page content embeddingModel embeddingVersion createdAt")
      .sort({ createdAt: -1 })
      .limit(MAX_VECTORS_PER_CATEGORY)
      .lean();
    return chunks as unknown as ChunkLite[];
  },
  async loadActiveRecords(categoryId) {
    const records = await BrainDatasetRecord.find({ categoryId: oid(categoryId), status: "active" })
      .select("+embedding datasetKey table primaryKeyValue data status cardText embeddingModel embeddingVersion updatedAt")
      .lean();
    return records as unknown as RecordLite[];
  },
  async loadDefinitions(categoryId, datasetKeys) {
    const stored = await BrainDatasetDefinitionRecord.find({ categoryId: oid(categoryId), key: { $in: datasetKeys } }).lean();
    const byKey = new Map(stored.map((s) => [s.key, s.definition as DatasetDefinition]));
    const out: DatasetDefinition[] = [];
    for (const key of datasetKeys) {
      const def = byKey.get(key) ?? builtinDefinitions.find((d) => d.key === key);
      if (def) out.push(def);
    }
    return out;
  },
  embeddingIdentity() {
    const provider = getEmbeddingProvider();
    return provider ? { model: provider.model, version: provider.version } : null;
  },
  async embedQuestion(question) {
    const provider = getEmbeddingProvider();
    if (!provider) return null;
    try {
      const [vector] = await embedInBatches(provider, [question], 1);
      return vector ?? null;
    } catch {
      return null;
    }
  },
};
