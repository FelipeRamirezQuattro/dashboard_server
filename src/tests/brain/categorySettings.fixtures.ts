/// <reference types="node" />
import { parseSettings, resolveNewCategorySettings } from "../../services/workflowBrainCategory.service";
import { NON_CHUNK_MEMORY_FILTER } from "../../models/WorkflowBrain.model";

const assert = (c: unknown, m: string): void => {
  if (!c) throw new Error(m);
};
const rejects400 = (input: Record<string, unknown>, label: string): void => {
  try {
    parseSettings(input);
  } catch (e) {
    assert((e as { statusCode?: number }).statusCode === 400, `${label}: statusCode 400`);
    return;
  }
  throw new Error(`${label}: should be rejected`);
};

const valid = parseSettings({ accessRole: "admin", groundingMode: "strict", minEvidenceCount: 5 });
assert(
  valid.accessRole === "admin" && valid.groundingMode === "strict" && valid.minEvidenceCount === 5,
  "valid settings accepted",
);
for (const v of [0, 11, 1.5, "2"]) rejects400({ minEvidenceCount: v }, `minEvidenceCount ${JSON.stringify(v)}`);
rejects400({ accessRole: "superadmin" }, "accessRole superadmin");
rejects400({ groundingMode: "loose" }, "groundingMode loose");

const ignored = parseSettings({ name: "x", isActive: false, bogus: 1 });
assert(Object.keys(ignored).length === 0, "unknown keys ignored");

assert(resolveNewCategorySettings({ name: "x" }).groundingMode === "strict", "new category defaults strict");
assert(
  resolveNewCategorySettings({ groundingMode: "standard" }).groundingMode === "standard",
  "explicit standard kept",
);
assert(resolveNewCategorySettings({ minEvidenceCount: 3 }).minEvidenceCount === 3, "other settings pass through");

assert(
  JSON.stringify(NON_CHUNK_MEMORY_FILTER) === JSON.stringify({ type: { $ne: "document_chunk" } }),
  "memory filter shape",
);
console.log("categorySettings fixtures passed");
