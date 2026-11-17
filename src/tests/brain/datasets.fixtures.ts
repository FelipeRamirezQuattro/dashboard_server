/// <reference types="node" />
import {
  buildTemplateFiles,
  decideCommit,
  planRevisions,
  resolveFileIssues,
  totalImportBytes,
  validateDefinitionShape,
  MAX_IMPORT_BYTES,
  builtinDefinitions,
} from "../../services/brain/datasets.service";
import { primaryKeyValueOf, buildRecordCards } from "../../services/brain/recordCards";
import { rodPumpFailureDefinition } from "../../services/brain/definitions/rodPumpFailure";
import { DatasetDefinition } from "../../services/brain/types";

const assert = (cond: unknown, message: string): void => {
  if (!cond) throw new Error(message);
};
const assertEqual = (actual: unknown, expected: unknown, message: string): void => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}. Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
};
const throws = (fn: () => unknown): boolean => {
  try {
    fn();
  } catch {
    return true;
  }
  return false;
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

// ---- planRevisions
assertEqual(planRevisions([], ["a", "b"]), [{ pk: "a", revision: 1 }, { pk: "b", revision: 1 }], "new pks are revision 1");
assertEqual(
  planRevisions([{ pk: "a", revision: 1 }], ["a"]),
  [{ pk: "a", revision: 2, supersedes: "a" }],
  "existing pk bumps revision",
);
assertEqual(
  planRevisions([{ pk: "a", revision: 3 }, { pk: "z", revision: 1 }], ["b", "a"]),
  [{ pk: "b", revision: 1 }, { pk: "a", revision: 4, supersedes: "a" }],
  "mixed new and existing, incoming order kept",
);
assert(throws(() => planRevisions([], ["a", "a"])), "duplicate incoming pks throw");

// ---- resolveFileIssues
const names = new Map<string, number>([["one.pdf", 1], ["dup.pdf", 2]]);
assertEqual(resolveFileIssues([{ rowNumber: 2, file_name: "one.pdf" }], names), [], "count 1 gives no issue");
const missing = resolveFileIssues([{ rowNumber: 5, file_name: "gone.pdf" }], names);
assertEqual(missing.length, 1, "count 0 gives one issue");
assertEqual(
  [missing[0].severity, missing[0].code, missing[0].row, missing[0].file, missing[0].column],
  ["warn", "FILE_NOT_FOUND", 5, "evidence.csv", "file_name"],
  "count 0 is a FILE_NOT_FOUND warning",
);
const amb = resolveFileIssues([{ rowNumber: 7, file_name: "dup.pdf" }], names);
assertEqual(
  [amb.length, amb[0].severity, amb[0].code, amb[0].row, amb[0].file, amb[0].column],
  [1, "reject", "AMBIGUOUS_FILE", 7, "evidence.csv", "file_name"],
  "count 2 is an AMBIGUOUS_FILE reject",
);
assert(!JSON.stringify([...missing, ...amb]).includes("gone.pdf"), "messages do not echo cell values");

// ---- buildTemplateFiles
const tpl = buildTemplateFiles(rodPumpFailureDefinition);
for (const t of rodPumpFailureDefinition.tables) {
  assert(typeof tpl[t.file] === "string", `template has ${t.file}`);
  assertEqual(tpl[t.file].split(/\r?\n/)[0], t.columns.map((c) => c.name).join(","), `${t.file} header is the columns in order`);
  assertEqual(tpl[t.file].trim().split(/\r?\n/).length, 1, `${t.file} has no data rows`);
}
assert(typeof tpl["README.txt"] === "string", "template has README.txt");
assert(/required/i.test(tpl["README.txt"]) && tpl["README.txt"].includes("case_id"), "README lists required columns");
assert(tpl["README.txt"].includes("pump_failure") && tpl["README.txt"].includes("tubing_failure"), "README lists enum values");
assertEqual(Object.keys(tpl).length, rodPumpFailureDefinition.tables.length + 1, "only table files and README");

// ---- primaryKeyValueOf (shared with record cards)
const wear = rodPumpFailureDefinition.tables.find((t) => t.name === "wear")!;
assertEqual(primaryKeyValueOf(wear, { case_id: "C1", location: "plunger_in", position_ft: 0 }), "C1|plunger_in|0", "composite key joined with |");
const cases = rodPumpFailureDefinition.tables.find((t) => t.name === "cases")!;
assertEqual(primaryKeyValueOf(cases, { case_id: "C1" }), "C1", "single key");
const cards = buildRecordCards(rodPumpFailureDefinition, {
  cases: [{ case_id: "C1" }],
  wear: [{ case_id: "C1", location: "plunger_in", position_ft: 12 }],
});
assert(cards[0].rowEvidence.some((e) => e.id === `ds:rod_pump_failure/wear/${primaryKeyValueOf(wear, { case_id: "C1", location: "plunger_in", position_ft: 12 })}`), "ids match shared helper");

// ---- decideCommit
const warn = { file: "evidence.csv", row: 2, severity: "warn" as const, code: "X", message: "m" };
const rej = { ...warn, severity: "reject" as const };
assertEqual(decideCommit({ canCommit: true, issues: [] }, false), "ok", "no issues is ok");
assertEqual(decideCommit({ canCommit: true, issues: [warn] }, false), "needs_ack", "warnings need ack");
assertEqual(decideCommit({ canCommit: true, issues: [warn] }, true), "ok", "acknowledged warnings ok");
assertEqual(decideCommit({ canCommit: false, issues: [rej] }, true), "has_rejects", "rejects block even if acknowledged");
assertEqual(decideCommit({ canCommit: false, issues: [] }, true), "has_rejects", "canCommit false blocks");
assertEqual(decideCommit({ canCommit: true, issues: [warn, rej] }, true), "has_rejects", "reject among warnings blocks");

// ---- totalImportBytes
assertEqual(totalImportBytes({ "a.csv": "abc", "b.csv": "é" }), 5, "counts utf8 bytes");
assertEqual(totalImportBytes({}), 0, "empty is zero");
assertEqual(MAX_IMPORT_BYTES, 12 * 1024 * 1024, "limit is 12 MB");

// ---- validateDefinitionShape
assertEqual(validateDefinitionShape(rodPumpFailureDefinition), [], "rod pump definition is valid");
assertEqual(builtinDefinitions.map((d) => d.key), ["rod_pump_failure"], "built-ins");

const bad = (mutate: (d: DatasetDefinition) => void): string[] => {
  const d = clone(rodPumpFailureDefinition);
  mutate(d);
  return validateDefinitionShape(d);
};
assert(bad((d) => (d.tables[0].primaryKey = ["nope"])).length > 0, "missing pk column rejected");
assert(bad((d) => (d.tables[1].references[0].refColumn = "nope")).length > 0, "dangling reference column rejected");
assert(bad((d) => (d.tables[1].references[0].table = "nope")).length > 0, "dangling reference table rejected");
assert(bad((d) => ((d.tables[0].columns[0] as { type: string }).type = "bigint")).length > 0, "unknown column type rejected");
assert(bad((d) => (d.card = { rootTable: "nope", include: [] })).length > 0, "unknown card root rejected");
assert(bad((d) => (d.tables[0].columns[1].name = d.tables[0].columns[0].name)).length > 0, "duplicate column rejected");
assert(bad((d) => { d.tables[0].columns.find((c) => c.type === "enum")!.values = undefined; }).length > 0, "enum without values rejected");
assert(validateDefinitionShape({ key: 1 }).length > 0, "garbage rejected");
assert(validateDefinitionShape(null).length > 0, "null rejected");

console.log("datasets fixtures passed");
