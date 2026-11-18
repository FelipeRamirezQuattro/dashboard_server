import { tokensFor } from "./text";

export interface ScoredId {
  id: string;
  score: number;
}

const clamp = (value: number): number => (value > 1 ? 1 : value < -1 ? -1 : value);

const norm = (v: number[]): number => {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  return Math.sqrt(sum);
};

const dot = (a: number[], b: number[]): number => {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
};

const cosineWithNorms = (a: number[], b: number[], normA: number, normB: number): number => {
  if (normA === 0 || normB === 0) return 0;
  return clamp(dot(a, b) / (normA * normB));
};

export const cosine = (a: number[], b: number[]): number => {
  if (a.length !== b.length) {
    throw new Error(`cosine: vector length mismatch (${a.length} vs ${b.length})`);
  }
  return cosineWithNorms(a, b, norm(a), norm(b));
};

// True when x ranks strictly worse than y (lower score, or equal score and larger id).
const worse = (x: ScoredId, y: ScoredId): boolean =>
  x.score < y.score || (x.score === y.score && x.id > y.id);

const siftUp = (heap: ScoredId[], start: number): void => {
  let i = start;
  while (i > 0) {
    const parent = (i - 1) >> 1;
    if (!worse(heap[i], heap[parent])) break;
    [heap[i], heap[parent]] = [heap[parent], heap[i]];
    i = parent;
  }
};

const siftDown = (heap: ScoredId[], start: number): void => {
  let i = start;
  for (;;) {
    const left = 2 * i + 1;
    const right = left + 1;
    let smallest = i;
    if (left < heap.length && worse(heap[left], heap[smallest])) smallest = left;
    if (right < heap.length && worse(heap[right], heap[smallest])) smallest = right;
    if (smallest === i) break;
    [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
    i = smallest;
  }
};

const byScoreThenId = (a: ScoredId, b: ScoredId): number =>
  b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Top-k by cosine similarity using a bounded heap: O(n log k) time, O(k) extra memory.
 * Items whose vector length differs from the query, and NaN scores, are skipped.
 */
export const rankByCosine = (
  query: number[],
  items: { id: string; vector: number[] }[],
  k: number,
): ScoredId[] => {
  if (!(k > 0)) return [];
  const limit = Math.floor(k);
  if (limit < 1) return [];
  const queryNorm = norm(query);
  const heap: ScoredId[] = [];
  for (const item of items) {
    if (item.vector.length !== query.length) continue;
    const score = cosineWithNorms(query, item.vector, queryNorm, norm(item.vector));
    if (Number.isNaN(score)) continue;
    if (heap.length < limit) {
      heap.push({ id: item.id, score });
      siftUp(heap, heap.length - 1);
    } else if (worse(heap[0], { id: item.id, score })) {
      heap[0] = { id: item.id, score };
      siftDown(heap, 0);
    }
  }
  return heap.sort(byScoreThenId);
};

/** Reciprocal-rank fusion: score(id) = sum over lists of 1 / (k + rank), rank 1-based. */
export const rrfMerge = (lists: string[][], k = 60): ScoredId[] => {
  const scores = new Map<string, number>();
  for (const list of lists) {
    const seen = new Set<string>();
    let rank = 0;
    for (const id of list) {
      if (seen.has(id)) continue;
      seen.add(id);
      rank += 1;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank));
    }
  }
  return Array.from(scores, ([id, score]) => ({ id, score })).sort(byScoreThenId);
};

/** Token-overlap ranking; returns ids of items sharing at least one token with the question. */
export const keywordRank = (question: string, items: { id: string; text: string }[]): string[] => {
  const questionTokens = new Set(tokensFor(question));
  if (questionTokens.size === 0) return [];
  const matches: { id: string; overlap: number; length: number }[] = [];
  for (const item of items) {
    const itemTokens = new Set(tokensFor(item.text));
    let overlap = 0;
    for (const token of questionTokens) if (itemTokens.has(token)) overlap += 1;
    if (overlap > 0) matches.push({ id: item.id, overlap, length: item.text.length });
  }
  matches.sort(
    (a, b) =>
      b.overlap - a.overlap || a.length - b.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return matches.map((m) => m.id);
};
