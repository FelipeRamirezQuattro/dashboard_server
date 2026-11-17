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

const dir = path.resolve(__dirname, "../../../../docs/rod-pump-failure-sample-data");
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
  const files = r.issues.map((i) => i.file).sort().join(",");
  assert(files === "solids.csv,solids.csv,wear.csv", `files ${files}`);
  assert(r.issues.every((i) => i.row >= 2), "row refers to cases.csv row");
});

test("definition shape", () => {
  const d = rodPumpFailureDefinition;
  assert(d.key === "rod_pump_failure" && d.version === "0.1", "key/version");
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
