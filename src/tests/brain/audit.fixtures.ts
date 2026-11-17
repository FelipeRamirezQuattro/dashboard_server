/// <reference types="node" />
import { pickBrainAuditMetadata } from "../../services/brainAudit.service";

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
const canon = (value: unknown) =>
  JSON.stringify(Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))));
const same = (a: unknown, b: unknown) => canon(a) === canon(b);

assert(
  same(
    pickBrainAuditMetadata({ categoryId: "a", prompt: "secret", rows: 3, content: "x", documentId: "d" }),
    { categoryId: "a", rows: 3, documentId: "d" },
  ),
  "non-allowlisted keys dropped",
);
assert(
  same(pickBrainAuditMetadata({ requestId: "x".repeat(81), status: "x".repeat(80) }), { status: "x".repeat(80) }),
  "81-char string dropped, 80 kept",
);
assert(
  same(
    pickBrainAuditMetadata({ counts: { a: 1 }, issues: [1, 2], rows: 2, status: undefined, importBatchId: null }),
    { rows: 2 },
  ),
  "objects, arrays, undefined and null dropped",
);
assert(
  same(pickBrainAuditMetadata({ issues: 4, status: true, rows: Number.NaN }), { issues: 4, status: true }),
  "numbers/booleans kept, NaN dropped",
);
assert(same(pickBrainAuditMetadata({}), {}), "empty in, empty out");
console.log("audit fixtures OK");
