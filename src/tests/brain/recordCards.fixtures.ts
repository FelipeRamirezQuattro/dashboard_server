/// <reference types="node" />
import fs from "fs";
import path from "path";
import { buildRecordCards } from "../../services/brain/recordCards";
import { validateDataset } from "../../services/brain/datasetValidator";
import { rodPumpFailureDefinition } from "../../services/brain/definitions/rodPumpFailure";

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
const cases: { name: string; run: () => void }[] = [];
const test = (name: string, run: () => void): void => {
  cases.push({ name, run });
};

const dir = path.resolve(__dirname, "../../../../docs/rod-pump-failure-sample-data");
const files: Record<string, string> = {};
for (const n of ["cases", "components", "wear", "solids", "actions", "evidence"]) {
  files[`${n}.csv`] = fs.readFileSync(path.join(dir, `${n}.csv`), "utf8");
}
const report = validateDataset(rodPumpFailureDefinition, files);
assert(report.canCommit, "sample data must commit");
const rows = report.rows;
const cards = buildRecordCards(rodPumpFailureDefinition, rows);
const card = (id: string) => {
  const c = cards.find((x) => x.primaryKeyValue === id);
  assert(c, `card ${id} missing`);
  return c!;
};
const count = (id: string, table: string): number =>
  card(id).rowEvidence.filter((e) => e.table === table).length;

test("one card per root row", () => {
  assert(cards.length === rows.cases.length, `cards ${cards.length} vs ${rows.cases.length}`);
});

test("DEMO-001 evidence counts", () => {
  const c = card("DEMO-001");
  assert(c.rowEvidence.length === 10, `total ${c.rowEvidence.length}`);
  assert(count("DEMO-001", "cases") === 1, "1 root");
  assert(c.rowEvidence[0].table === "cases", "root first");
  assert(count("DEMO-001", "components") === 4, "4 components");
  assert(count("DEMO-001", "wear") === 4, "4 wear");
  assert(count("DEMO-001", "solids") === 0, "0 solids");
  assert(count("DEMO-001", "actions") === 1, "1 action");
  assert(c.rowEvidence.every((e) => e.id.startsWith("ds:rod_pump_failure/")), "id prefix");
});

test("wear row id and text", () => {
  const w = card("DEMO-001").rowEvidence.find((e) => e.id === "ds:rod_pump_failure/wear/DEMO-001|plunger_in|0");
  assert(w, "wear evidence missing");
  assert(w!.table === "wear", "table");
  assert(w!.text.includes("value=6") && w!.text.includes("unit=mil"), `wear text: ${w!.text}`);
  assert(w!.text.startsWith("wear: "), "line prefix");
});

test("DEMO-002 card text", () => {
  const t = card("DEMO-002").text;
  assert(t.includes("hydrocarbon_paraffin") && t.includes("89.7"), "solids present");
});

test("text is root line then child lines in evidence order", () => {
  for (const c of cards) {
    assert(c.text === c.rowEvidence.map((e) => e.text).join("\n"), `text/evidence mismatch ${c.primaryKeyValue}`);
    assert(c.text.split("\n").every((l) => /^[a-z_]+: /.test(l)), "line shape");
  }
  const order = card("DEMO-001").rowEvidence.map((e) => e.table);
  const rank = ["cases", "components", "wear", "solids", "actions"];
  assert(order.every((t, i) => i === 0 || rank.indexOf(order[i - 1]) <= rank.indexOf(t)), `group order ${order}`);
});

test("deterministic and independent of input row order", () => {
  const again = buildRecordCards(rodPumpFailureDefinition, rows);
  assert(JSON.stringify(again) === JSON.stringify(cards), "second build differs");
  const rev: Record<string, Record<string, unknown>[]> = {};
  for (const [k, v] of Object.entries(rows)) rev[k] = [...v].reverse();
  const r = buildRecordCards(rodPumpFailureDefinition, rev);
  const byKey = (a: typeof cards) => JSON.stringify([...a].sort((x, y) => (x.primaryKeyValue < y.primaryKeyValue ? -1 : 1)));
  assert(byKey(r) === byKey(cards), "reversed input changed output");
});

test("numeric tokens all come from source rows", () => {
  const src = new Set<string>();
  for (const table of Object.values(rows)) {
    for (const row of table) {
      for (const v of Object.values(row)) {
        const s = Array.isArray(v) ? v.join(",") : String(v);
        for (const m of s.match(/\d+(?:\.\d+)?/g) ?? []) src.add(m);
      }
    }
  }
  for (const c of cards) {
    for (const m of c.text.match(/\d+(?:\.\d+)?/g) ?? []) {
      assert(src.has(m), `token ${m} not in source rows (${c.primaryKeyValue})`);
    }
  }
});

test("empty values skipped, booleans and lists rendered", () => {
  const t = card("DEMO-001").text;
  assert(!/=(;|$)/m.test(t) && !t.includes("=undefined") && !t.includes("=null"), "no empty pairs");
  assert(/is_primary_failure=true/.test(t) && /is_primary_failure=false/.test(t), "booleans");
  assert(t.includes("primary_failure_mechanism=wear, seal_loss_vacuum_fail"), "list joined with comma+space");
});

test("no card definition yields no cards", () => {
  assert(buildRecordCards({ ...rodPumpFailureDefinition, card: undefined }, rows).length === 0, "expected []");
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
if (failed > 0) throw new Error(`${failed} record card case(s) failed`);
