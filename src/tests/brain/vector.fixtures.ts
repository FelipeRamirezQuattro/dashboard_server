/// <reference types="node" />
import { cosine, keywordRank, rankByCosine, rrfMerge } from "../../services/brain/vector";

const assertDeepEqual = (actual: unknown, expected: unknown, message: string): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
const throws = (run: () => unknown, message: string): void => {
  try {
    run();
  } catch {
    return;
  }
  throw new Error(message);
};

// cosine
assert(cosine([1, 0], [1, 0]) === 1, "identical vectors score 1");
assert(cosine([1, 0], [0, 1]) === 0, "orthogonal vectors score 0");
assert(cosine([1, 0], [-1, 0]) === -1, "opposite vectors score -1");
assert(cosine([0, 0], [1, 0]) === 0, "zero vector scores 0");
assert(cosine([1, 0], [0, 0]) === 0, "zero vector (b) scores 0");
assert(cosine([0.1, 0.2, 0.3], [0.1, 0.2, 0.3]) <= 1, "result clamped to <= 1");
assert(Math.abs(cosine([1, 1], [1, 0]) - Math.SQRT1_2) < 1e-12, "45 degrees");
throws(() => cosine([1, 0], [1, 0, 0]), "length mismatch throws");

// rankByCosine
const items = [
  { id: "c", vector: [0, 1] },
  { id: "b", vector: [1, 1] },
  { id: "a", vector: [1, 0] },
  { id: "a2", vector: [2, 0] },
  { id: "bad", vector: [1, 0, 0] },
  { id: "nan", vector: [Number.NaN, 0] },
];
const ranked = rankByCosine([1, 0], items, 3);
assertDeepEqual(
  ranked.map((r) => r.id),
  ["a", "a2", "b"],
  "top-k ordered by score desc then id asc, corrupt/NaN skipped",
);
assert(ranked[0].score === 1, "top score is 1");
assertDeepEqual(rankByCosine([1, 0], items, 0), [], "k=0 returns empty");
assertDeepEqual(rankByCosine([1, 0], items, -2), [], "negative k returns empty");
assertDeepEqual(rankByCosine([1, 0], items, 100).length, 4, "k larger than items returns all valid");
assertDeepEqual(rankByCosine([1, 0], [], 5), [], "no items");
assertDeepEqual(
  rankByCosine([1, 0], [{ id: "z", vector: [0, 0] }], 5),
  [{ id: "z", score: 0 }],
  "zero-norm item scores 0",
);

// rrfMerge
const merged = rrfMerge([
  ["a", "b"],
  ["b", "c"],
]);
assertDeepEqual(
  merged.map((m) => m.id),
  ["b", "a", "c"],
  "b ranks first",
);
assert(Math.abs(merged[0].score - (1 / 62 + 1 / 61)) < 1e-12, "b score sums both lists");
assertDeepEqual(
  rrfMerge([["a", "a", "b"]]).map((m) => m.id),
  ["a", "b"],
  "duplicates in a list count once",
);
assert(Math.abs(rrfMerge([["a", "a"]])[0].score - 1 / 61) < 1e-12, "duplicate only counts first occurrence");
assertDeepEqual(
  rrfMerge([["b"], ["a"]]).map((m) => m.id),
  ["a", "b"],
  "ties by id asc",
);
assert(Math.abs(rrfMerge([["a"]], 10)[0].score - 1 / 11) < 1e-12, "custom k");
assertDeepEqual(rrfMerge([]), [], "no lists");

// keywordRank
const docs = [
  { id: "none", text: "pump rod stroke length" },
  { id: "one", text: "galling noted" },
  { id: "two", text: "galling in the pump barrel wear" },
  { id: "twoShort", text: "barrel galling" },
];
assertDeepEqual(
  keywordRank("galling in barrel", docs),
  ["twoShort", "two", "one"],
  "overlap desc, shorter text first, no-overlap ignored",
);
assertDeepEqual(keywordRank("the of and", docs), [], "empty question tokens");
assertDeepEqual(
  keywordRank("galling", [
    { id: "b", text: "galling" },
    { id: "a", text: "galling" },
  ]),
  ["a", "b"],
  "final tie by id asc",
);
assertDeepEqual(
  keywordRank("galling galling", [{ id: "x", text: "galling galling" }, { id: "y", text: "barrel galling noted" }]),
  ["x", "y"],
  "repeated tokens do not inflate overlap (distinct count, shorter text wins tie)",
);

console.log("vector fixtures passed");
