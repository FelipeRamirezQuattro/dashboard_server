/// <reference types="node" />
import fs from "fs";
import path from "path";
import { validateDataset } from "../../services/brain/datasetValidator";
import { rodPumpFailureDefinition } from "../../services/brain/definitions/rodPumpFailure";
import { ImportReport } from "../../services/brain/types";

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void): void => {
  cases.push({ name, run });
};

const dir = path.resolve(__dirname, "data/rod-pump-engine-sample");
const names = ["cases", "components", "wear", "solids", "actions", "evidence"];
const base: Record<string, string> = {};
for (const n of names) base[`${n}.csv`] = fs.readFileSync(path.join(dir, `${n}.csv`), "utf8");

const run = (over: Record<string, string> = {}): ImportReport =>
  validateDataset(rodPumpFailureDefinition, { ...base, ...over });
const replaceIn = (file: string, from: string, to: string): Record<string, string> => {
  assert(base[file].includes(from), `fixture setup: "${from}" not in ${file}`);
  return { [file]: base[file].replace(from, to) };
};
const rejected = (r: ImportReport, file: string, column: string): boolean =>
  r.issues.some((i) => i.severity === "reject" && i.file === file && i.column === column);
const warnCodes = (r: ImportReport, code: string): number =>
  r.issues.filter((i) => i.severity === "warn" && i.code === code).length;

test("sample data commits with exactly three case_has_children warnings", () => {
  const r = run();
  assert(r.canCommit, `canCommit false: ${JSON.stringify(r.issues)}`);
  assert(r.issues.every((i) => i.severity === "warn"), "unexpected reject");
  assert(r.issues.length === 3, `expected 3 issues, got ${r.issues.length}`);
  assert(r.issues.every((i) => i.code === "case_has_children"), "all case_has_children");
  assert(r.issues.every((i) => i.file === "cases.csv" && i.column === "case_id"), "filed under cases.csv");
  const msgs = r.issues.map((i) => `${i.row}|${i.message}`).sort();
  const want = ["DEMO-001 has no rows in solids.csv", "DEMO-003 has no rows in solids.csv", "DEMO-003 has no rows in wear.csv"];
  for (const w of want) assert(r.issues.some((i) => i.message === `case ${w}`), `missing message for ${w}: ${msgs.join(";")}`);
  const line = (id: string): number => base["cases.csv"].split("\n").findIndex((l) => l.startsWith(`${id},`)) + 1;
  assert(r.issues.filter((i) => i.message.includes("DEMO-003")).every((i) => i.row === line("DEMO-003")), "DEMO-003 row");
  assert(r.issues.find((i) => i.message.includes("DEMO-001"))?.row === line("DEMO-001"), "DEMO-001 row");
});

test("definition shape", () => {
  const d = rodPumpFailureDefinition;
  assert(d.key === "rod_pump_failure" && d.version === "0.2", "key/version");
  assert(d.tables.length === 6, "six tables");
  assert(d.tables.filter((t) => t.required).map((t) => t.name).join() === "cases", "only cases required");
  assert(d.card?.rootTable === "cases" && d.card.include.join() === "components,wear,solids,actions", "card");
});

test("bad reason_for_pulling rejected", () => {
  const r = run(replaceIn("cases.csv", "DEMO-001,DP-1001,20-125-RHBC-16-5-4,2025-11-04,210,2025-04-08,pump_failure", "DEMO-001,DP-1001,20-125-RHBC-16-5-4,2025-11-04,210,2025-04-08,bad"));
  assert(!r.canCommit && rejected(r, "cases.csv", "reason_for_pulling"), "reason_for_pulling");
});

test("observed_modes with unknown code rejected", () => {
  const r = run(replaceIn("components.csv", ",worn,C,wear,", ",worn,C,wear;nonsense,"));
  assert(!r.canCommit && rejected(r, "components.csv", "observed_modes"), "observed_modes");
});

test("wear unit cm rejected", () => {
  const r = run(replaceIn("wear.csv", "DEMO-001,plunger_in,0,6,mil", "DEMO-001,plunger_in,0,6,cm"));
  assert(!r.canCommit && rejected(r, "wear.csv", "unit"), "unit");
});

test("negative wear value rejected", () => {
  const r = run(replaceIn("wear.csv", "DEMO-001,plunger_in,0,6,mil", "DEMO-001,plunger_in,0,-1,mil"));
  assert(!r.canCommit && rejected(r, "wear.csv", "value"), "value");
});

test("components.case_id dangling rejected", () => {
  const r = run(replaceIn("components.csv", "DEMO-001,DEMO-001-plunger", "NOPE,DEMO-001-plunger"));
  assert(!r.canCommit && rejected(r, "components.csv", "case_id"), "case_id");
});

test("actions.next_case_id dangling rejected", () => {
  const r = run(replaceIn("actions.csv", "yes,DEMO-002,", "yes,NOPE,"));
  assert(!r.canCommit && rejected(r, "actions.csv", "next_case_id"), "next_case_id");
});

test("duplicate wear key rejected", () => {
  const r = run({ "wear.csv": `${base["wear.csv"].trimEnd()}\nDEMO-001,plunger_in,0,9,mil\n` });
  assert(!r.canCommit && r.issues.some((i) => i.code === "DUPLICATE_KEY" && i.file === "wear.csv"), "dup");
});

test("wear composite key part with | rejected", () => {
  const r = run({ "wear.csv": `${base["wear.csv"].trimEnd()}\nDEMO|001,plunger_in,5,9,mil\n` });
  assert(r.issues.some((i) => i.code === "PK_CONTAINS_SEPARATOR" && i.severity === "reject" && i.file === "wear.csv" && i.column === "case_id"), "wear case_id with |");
});

test("days_run mismatch warns, does not reject", () => {
  const r = run(replaceIn("cases.csv", "2025-11-04,210,2025-04-08", "2025-11-04,300,2025-04-08"));
  assert(r.canCommit && warnCodes(r, "days_run_consistency") === 1, "days_run_consistency");
  assert(warnCodes(run(), "days_run_consistency") === 0, "sample is consistent");
});

test("solids sum 90 warns", () => {
  const r = run(replaceIn("solids.csv", "DEMO-002,hydrocarbon_paraffin,89.7", "DEMO-002,hydrocarbon_paraffin,79.7"));
  assert(r.canCommit && warnCodes(r, "solids_sum") === 1, "solids_sum");
});

test("tubing_failure with mechanism warns", () => {
  const r = run(replaceIn("cases.csv", "tubing_failure,Tubing failure,,", "tubing_failure,Tubing failure,wear,"));
  assert(r.canCommit && warnCodes(r, "tubing_failure_mechanism") === 1, "tubing_failure_mechanism");
});

test("true source line survives rejected row and multi-line cell", () => {
  const hdr = base["cases.csv"].split("\n")[0];
  const c = (id: string, reason: string, summary: string): string =>
    `${id},S-${id},20-125-RHBC-16-5-4,2025-11-04,210,,${reason},,,,,${summary},,Demo`;
  const text = [hdr, c("A-1", "bad", ""), c("A-2", "pump_failure", '"line one\nline two\nline three"'), c("A-3", "pump_failure", "")].join("\n") + "\n";
  const r = validateDataset(rodPumpFailureDefinition, { "cases.csv": text });
  assert(!r.canCommit, "A-1 rejected");
  const w = r.issues.filter((i) => i.code === "case_has_children" && i.message.includes("A-3"));
  assert(w.length === 3, "three A-3 warnings");
  assert(w.every((i) => i.file === "cases.csv" && i.row === 6), `A-3 row ${w.map((i) => i.row)}`);
  assert(r.issues.filter((i) => i.message.includes("A-2")).every((i) => i.row === 3), "A-2 row 3");
  assert(!Object.keys(r.rows.cases[0]).includes("line"), "no extra enumerable props");
});

test("days_run boundary: 2 days off ok, 3 warns", () => {
  assert(warnCodes(run(replaceIn("cases.csv", "2025-11-04,210,2025-04-08", "2025-11-04,212,2025-04-08")), "days_run_consistency") === 0, "2 ok");
  assert(warnCodes(run(replaceIn("cases.csv", "2025-11-04,210,2025-04-08", "2025-11-04,213,2025-04-08")), "days_run_consistency") === 1, "3 warns");
});

test("definition flags pinned", () => {
  const c = "2025-11-04,210,2025-04-08";
  assert(rejected(run(replaceIn("cases.csv", c, "2999-01-01,210,2025-04-08")), "cases.csv", "pull_date"), "future pull_date");
  assert(rejected(run(replaceIn("cases.csv", c, "2025-11-04,-1,2025-04-08")), "cases.csv", "days_run"), "negative days_run");
  assert(rejected(run(replaceIn("cases.csv", "pump_failure,Pump failure,wear;seal_loss_vacuum_fail,167,", "pump_failure,Pump failure,wear;seal_loss_vacuum_fail,0,")), "cases.csv", "max_stroke_in"), "max_stroke_in 0");
  assert(rejected(run(replaceIn("solids.csv", "DEMO-002,hydrocarbon_paraffin,89.7", "DEMO-002,hydrocarbon_paraffin,101")), "solids.csv", "percent"), "percent 101");
});

let failed = 0;
for (const c of cases) {
  try {
    c.run();
    console.log(`ok - ${c.name}`);
  } catch (e) {
    failed += 1;
    console.error(`not ok - ${c.name}: ${(e as Error).message}`);
  }
}
if (failed > 0) throw new Error(`${failed} rod pump case(s) failed`);
