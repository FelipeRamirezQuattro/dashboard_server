/// <reference types="node" />
// Pure / fake-port fixtures for hybrid retrieval. No database, no network.
import { rodPumpFailureDefinition } from "../../services/brain/definitions/rodPumpFailure";
import {
  buildChunkCandidates,
  buildDatasetCandidates,
  evidenceIdMatchesKey,
  findNamedKeys,
  retrieveEvidence,
  selectEvidence,
} from "../../services/brain/retrieval";
import type { ChunkLite, DocumentLite } from "../../services/brain/retrieval";
import type { Evidence } from "../../services/brain/types";
import { fakePorts, sampleRecords } from "./sampleData";

const failures: string[] = [];
const expect = (name: string, got: unknown, want: unknown): void => {
  if (JSON.stringify(got) !== JSON.stringify(want)) failures.push(`${name}: want ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
};
const ok = (name: string, cond: unknown): void => {
  if (!cond) failures.push(name);
};
const ev = (id: string, text: string, extra: Partial<Evidence> = {}): Evidence => ({
  id, kind: "row", text, label: id, score: 0, isGuidance: false, ...extra,
});
const P = "ds:rod_pump_failure/";

const main = async (): Promise<void> => {
  // ---- findNamedKeys
  expect("named: case-insensitive", findNamedKeys("why did demo-001 fail", ["DEMO-001", "DEMO-002"]), ["DEMO-001"]);
  expect("named: DEMO-0011 is not DEMO-001", findNamedKeys("what about DEMO-0011?", ["DEMO-001"]), []);
  expect("named: prefix letters block", findNamedKeys("xDEMO-001", ["DEMO-001"]), []);
  expect("named: punctuation ok", findNamedKeys("(DEMO-001), DEMO-002.", ["DEMO-001", "DEMO-002", "DEMO-003"]), ["DEMO-001", "DEMO-002"]);
  expect("named: regex metacharacters escaped", findNamedKeys("case A.1+ and a1", ["A.1+", "A.1", "a?1"]), ["A.1+", "A.1"]);
  expect("named: empty keys ignored", findNamedKeys("anything", ["", "  "]), []);
  expect("named: (.*) key is literal", findNamedKeys("nothing here", [".*"]), []);

  // ---- evidenceIdMatchesKey
  expect("key match: root", evidenceIdMatchesKey(`${P}cases/DEMO-001`, "DEMO-001"), true);
  expect("key match: composite part", evidenceIdMatchesKey(`${P}wear/DEMO-001|plunger_in|0`, "DEMO-001"), true);
  expect("key match: no prefix match", evidenceIdMatchesKey(`${P}cases/DEMO-0011`, "DEMO-001"), false);
  expect("key match: no substring match", evidenceIdMatchesKey(`${P}components/DEMO-001-plunger`, "DEMO-001"), false);
  expect("key match: chunk ids never", evidenceIdMatchesKey("doc:abc#DEMO-001", "DEMO-001"), false);

  // ---- selectEvidence
  const cands = [
    ev(`${P}cases/DEMO-001`, "zzz"), // named, no keyword overlap
    ev(`${P}cases/DEMO-002`, "plunger wear galling"),
    ev(`${P}cases/DEMO-003`, "tubing"),
    ev("doc:d1#0", "plunger wear guide"),
    ev("doc:g#0", "plunger wear guidance", { isGuidance: true }),
    ev(`${P}cases/DEMO-002`, "duplicate id"),
  ];
  const sel = selectEvidence({ question: "plunger wear DEMO-001", candidates: cands, namedKeys: ["DEMO-001"] });
  const selIds = sel.map((e) => e.id);
  expect("select: named first even with zero score", selIds[0], `${P}cases/DEMO-001`);
  ok("select: no-overlap/no-vector excluded", !selIds.includes(`${P}cases/DEMO-003`));
  ok("select: guidance never present", !selIds.includes("doc:g#0") && sel.every((e) => !e.isGuidance));
  expect("select: dedupe by id", selIds.filter((id) => id === `${P}cases/DEMO-002`).length, 1);
  expect("select: first duplicate wins", sel.find((e) => e.id === `${P}cases/DEMO-002`)?.text, "plunger wear galling");
  ok("select: scores set from fused rank", sel.filter((e) => e.id !== `${P}cases/DEMO-001`).every((e) => e.score > 0));
  const vec = selectEvidence({ question: "nothing matches", candidates: cands, namedKeys: [], vectorRanks: [`${P}cases/DEMO-003`, "unknown"] });
  expect("select: vector-only hit kept, unknown vector ids ignored", vec.map((e) => e.id), [`${P}cases/DEMO-003`]);
  const many = Array.from({ length: 100 }, (_, i) => ev(`${P}cases/C-${i}`, "plunger"));
  expect("select: default limit 40", selectEvidence({ question: "plunger", candidates: many, namedKeys: [] }).length, 40);
  const lim = selectEvidence({ question: "plunger", candidates: [...many, ev(`${P}cases/DEMO-009`, "x")], namedKeys: ["DEMO-009"], limit: 5 });
  expect("select: limit respected, named kept first", [lim.length, lim[0].id], [5, `${P}cases/DEMO-009`]);
  expect("select: namedIds kept", selectEvidence({ question: "q", candidates: [ev("a:x", "n")], namedKeys: [], namedIds: ["a:x"] }).map((e) => e.id), ["a:x"]);

  // ---- buildDatasetCandidates (sample data)
  const records = sampleRecords();
  const ds = buildDatasetCandidates(rodPumpFailureDefinition, records);
  const ids1 = ds.cardToEvidenceIds.get("DEMO-001") ?? [];
  expect("dataset: root first in card", ids1[0], `${P}cases/DEMO-001`);
  expect("dataset: DEMO-001 card has 10 card rows + 1 evidence-file row", ids1.length, 11);
  expect("dataset: evidence-file row attached last", ids1[10], `${P}evidence/EV-001`);
  ok("dataset: all row evidence", ds.evidence.every((e) => e.kind === "row" && !e.isGuidance));
  expect("dataset: unique ids", new Set(ds.evidence.map((e) => e.id)).size, ds.evidence.length);
  expect("dataset: label", ds.evidence.find((e) => e.id === `${P}cases/DEMO-001`)?.label, "cases DEMO-001");
  const evRow = ds.evidence.find((e) => e.id === `${P}evidence/EV-001`);
  expect("dataset: fileName from file_name", [evRow?.fileName, evRow?.page], ["demo-001-teardown-report.pdf", 1]);
  const cardText = ds.evidence.find((e) => e.id === `${P}cases/DEMO-001`)?.text ?? "";
  ok("dataset: text rebuilt from rows", cardText.startsWith("cases: case_id=DEMO-001"));
  // superseded / rolled_back records never become evidence (retrieval filters them; buildDatasetCandidates trusts input)
  const mixed = sampleRecords().map((r) =>
    r.primaryKeyValue === "DEMO-003" ? { ...r, status: "rolled_back" } :
    r.table === "solids" && r.primaryKeyValue === "DEMO-002|scale_fes" ? { ...r, status: "superseded" } : r);

  // ---- buildChunkCandidates
  const docs: DocumentLite[] = [
    { _id: "d1", title: "Teardown guide", kind: "facts", status: "active", sourceFormat: "md" },
    { _id: "d2", title: "Old guide", kind: "facts", status: "archived", sourceFormat: "md" },
    { _id: "d3", title: "Draft guide", kind: "procedure", status: "draft", sourceFormat: "md" },
    { _id: "g1", title: "Style", kind: "guidance", status: "active", sourceFormat: "md" },
    { _id: "p1", title: "Manual", kind: "procedure", status: "active", sourceFormat: "pdf" },
  ];
  const chunk = (documentId: string, chunkIndex: number, content: string, extra: Partial<ChunkLite> = {}): ChunkLite => ({
    documentId, chunkIndex, heading: "Wear", page: null, content, ...extra,
  });
  const chunks: ChunkLite[] = [
    chunk("d1", 0, "Plunger wear above 5 mil indicates slippage."),
    chunk("d2", 0, "Archived plunger wear text 999.", { embedding: [1, 0], embeddingModel: "m", embeddingVersion: "1" }),
    chunk("d3", 0, "Draft plunger wear text 888.", { embedding: [1, 0], embeddingModel: "m", embeddingVersion: "1" }),
    ...Array.from({ length: 7 }, (_, i) => chunk("g1", i, `${i === 6 ? "plunger " : ""}guidance ${i} ${"x".repeat(600)}`)),
    chunk("p1", 2, "Pump manual text.", { page: 4, heading: "Valves" }),
  ];
  const cc = buildChunkCandidates(docs, chunks, "plunger");
  expect("chunks: only active non-guidance evidence", cc.evidence.map((e) => e.id), ["doc:d1#0", "doc:p1#2"]);
  expect("chunks: label", cc.evidence.map((e) => e.label), ["Teardown guide — Wear", "Manual — Valves p.4"]);
  expect("chunks: pdf page", cc.evidence[1].page, 4);
  expect("chunks: guidance capped at 5", cc.guidance.length, 5);
  ok("chunks: guidance truncated to 500", cc.guidance.every((g) => g.length <= 500));
  ok("chunks: guidance keyword-relevant first", cc.guidance[0].startsWith("plunger guidance 6"));
  ok("chunks: no guidance evidence", cc.evidence.every((e) => !e.isGuidance && !e.id.startsWith("doc:g1")));

  // ---- retrieveEvidence over fake ports
  const identity = { model: "m", version: "1" };
  const base = await retrieveEvidence({ categoryId: "c1" }, "why did DEMO-001 fail?", fakePorts({ records, documents: docs, chunks }));
  const baseIds = base.evidence.map((e) => e.id);
  ok("retrieve: named case rows all included", ids1.every((id) => baseIds.includes(id)));
  ok("retrieve: named rows first", baseIds.slice(0, ids1.length).every((id) => ids1.includes(id)));
  ok("retrieve: archived/draft chunks never evidence", !baseIds.some((id) => id.startsWith("doc:d2") || id.startsWith("doc:d3")));
  ok("retrieve: guidance never evidence", !baseIds.some((id) => id.startsWith("doc:g1")) && base.guidance.length > 0);
  expect("retrieve: no duplicate ids", new Set(baseIds).size, baseIds.length);
  ok("retrieve: searched counts candidates", base.searched >= ds.evidence.length);

  const unknown = await retrieveEvidence({ categoryId: "c1" }, "what is the run life of DEMO-999?", fakePorts({ records, documents: docs, chunks }));
  expect("retrieve: unknown case id => no evidence", unknown.evidence.length, 0);

  // superseded / rolled_back never evidence (even with vectors)
  const mixedPorts = fakePorts({
    records: mixed.map((r) => (r.primaryKeyValue === "DEMO-003" ? { ...r, embedding: [1, 0], embeddingModel: "m", embeddingVersion: "1" } : r)),
    identity,
    embed: async () => [1, 0],
  });
  const mixedRes = await retrieveEvidence({ categoryId: "c1" }, "tubing failure DEMO-002 scale", mixedPorts);
  const mixedIds = mixedRes.evidence.map((e) => e.id);
  ok("retrieve: rolled_back root never evidence", !mixedIds.includes(`${P}cases/DEMO-003`));
  ok("retrieve: superseded row never evidence", !mixedIds.includes(`${P}solids/DEMO-002|scale_fes`));
  ok("retrieve: active rows still there", mixedIds.includes(`${P}cases/DEMO-002`));

  // vector-only hit on a card expands to its rows; archived-document vectors ignored; mismatched model ignored
  const withVec = records.map((r) =>
    r.table === "cases" && r.primaryKeyValue === "DEMO-003" ? { ...r, embedding: [0, 1], embeddingModel: "m", embeddingVersion: "1" } :
    r.table === "cases" && r.primaryKeyValue === "DEMO-002" ? { ...r, embedding: [0, 1], embeddingModel: "old", embeddingVersion: "1" } :
    r.table === "cases" && r.primaryKeyValue === "DEMO-001" ? { ...r, embedding: [0, 1], embeddingModel: "m", embeddingVersion: "0" } : r);
  const vPorts = fakePorts({ records: withVec, documents: docs, chunks, identity, embed: async () => [0, 1] });
  const vRes = await retrieveEvidence({ categoryId: "c1" }, "qqqq zzzz", vPorts);
  const vIds = vRes.evidence.map((e) => e.id);
  expect("retrieve: embed called", vPorts.embedCalls, 1);
  ok("retrieve: vector-only card hit expands to rows (root first)", vIds[0] === `${P}cases/DEMO-003` && vIds.length >= 1);
  ok("retrieve: model-mismatched vector ignored", !vIds.includes(`${P}cases/DEMO-002`));
  ok("retrieve: version-mismatched vector ignored", !vIds.includes(`${P}cases/DEMO-001`));
  // archived doc chunk carries a vector equal to the query: still excluded
  const aPorts = fakePorts({ records, documents: docs, chunks, identity, embed: async () => [1, 0] });
  const aRes = await retrieveEvidence({ categoryId: "c1" }, "qqqq zzzz", aPorts);
  ok("retrieve: archived/draft chunk vectors ignored", !aRes.evidence.some((e) => e.id.startsWith("doc:d2") || e.id.startsWith("doc:d3")));
  // stale card vector (cardText differs from the rebuilt card) is ignored
  const stale = records.map((r) => (r.table === "cases" && r.primaryKeyValue === "DEMO-003" ? { ...r, cardText: "old", embedding: [0, 1], embeddingModel: "m", embeddingVersion: "1" } : r));
  const sRes = await retrieveEvidence({ categoryId: "c1" }, "qqqq zzzz", fakePorts({ records: stale, identity, embed: async () => [0, 1] }));
  expect("retrieve: stale card vector ignored", sRes.evidence.length, 0);

  // embedding failure => keyword-only, no error
  const fail = fakePorts({ records: withVec, identity, embed: async () => { throw new Error("provider down"); } });
  const fRes = await retrieveEvidence({ categoryId: "c1" }, "paraffin solids", fail);
  ok("retrieve: embedding failure falls back to keywords", fRes.evidence.some((e) => e.id === `${P}solids/DEMO-002|hydrocarbon_paraffin`));
  const none = await retrieveEvidence({ categoryId: "c1" }, "paraffin solids", fakePorts({ records: withVec, identity: null }));
  expect("retrieve: no provider => keyword-only", none.evidence.map((e) => e.id), fRes.evidence.map((e) => e.id));

  if (failures.length) throw new Error(`${failures.length} retrieval fixture failures:\n${failures.join("\n")}`);
  console.log("retrieval fixtures passed");
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
