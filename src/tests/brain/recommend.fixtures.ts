/// <reference types="node" />
// "Best pump in a formation": the demo data (DBO-31, DBO-29, CMS-347, ACS-1228, AS-1508) is validated, turned into
// evidence rows, and answered through answerGroundedWith with a model that must never be called.
import { RODPUMP_DEMO_FILES } from "../../scripts/demoData/rodPumpDemo";
import { validateDataset } from "../../services/brain/datasetValidator";
import { rodPumpFailureDefinition } from "../../services/brain/definitions/rodPumpFailure";
import { answerGroundedWith } from "../../services/brain/groundedAnswer.service";
import { buildBestPumpStatements } from "../../services/brain/recommend";
import { buildDatasetCandidates } from "../../services/brain/retrieval";

let failed = 0;
const check = (name: string, ok: boolean, detail = ""): void => {
  console.log(`${ok ? "ok" : "not ok"} - ${name}${ok ? "" : ` ${detail}`}`);
  if (!ok) failed++;
};

const report = validateDataset(rodPumpFailureDefinition, RODPUMP_DEMO_FILES);
check("demo data commits (no rejects)", report.canCommit, JSON.stringify(report.issues.filter((i) => i.severity === "reject")));
const records = rodPumpFailureDefinition.tables.flatMap((t) => (report.rows[t.name] ?? []).map((data) => ({ table: t.name, data })));
const { evidence } = buildDatasetCandidates(rodPumpFailureDefinition, records);

const ports = {
  retrieve: async () => ({ evidence, guidance: [] as string[] }),
  callModel: async (): Promise<string> => {
    throw new Error("model must not be called for best-pump questions");
  },
};
const cat = { _id: "c1", name: "Rod Pump Failure", minEvidenceCount: 2 };
const ask = (question: string) => answerGroundedWith(ports as never, { category: cat, question, userId: "u1" });

const Q =
  "What is the best pump utilized in Middle Spraberry? Diameter, Barrel Material, Plunger type, Plunger fit, Max run life";

(async () => {
  const r = await ask(Q);
  check("best pump answered", r.status === "answered" && !r.insufficient, r.reply);
  check("winner is AS-1508 with 517 days", r.reply.includes("AS-1508") && r.reply.includes("Max run life: 517 days"), r.reply);
  check("diameter, fit, material, type present", /Diameter: 1\.25 in/.test(r.reply) && /Plunger fit: -0\.005 in/.test(r.reply) && /Barrel material: BR\/NC/.test(r.reply) && /Plunger type: Metal spray \(SM\)/.test(r.reply), r.reply);
  check("next longest is ACS-1228 (292)", /Next longest in Middle Spraberry: ACS-1228 with 292 days/.test(r.reply), r.reply);
  check("DRAFT line + stored-records tail", r.reply.includes("DRAFT") && /Based on \d+ stored records\./.test(r.reply), r.reply);
  check("Lower Spraberry case is not mixed in", !r.reply.includes("DBO-29"), r.reply);
  check("citations point at case rows", r.citations.length >= 2 && r.citations.every((c) => c.id.startsWith("ds:rod_pump_failure/cases/")), JSON.stringify(r.citations));

  const lower = await ask("best pump in Lower Spraberry by run life");
  check("Lower Spraberry winner is DBO-29 (194)", lower.reply.includes("DBO-29") && lower.reply.includes("194 days") && !lower.reply.includes("AS-1508"), lower.reply);

  check("no formation named -> null", buildBestPumpStatements("What is the best pump?", evidence) === null);
  check("unknown formation -> null", buildBestPumpStatements("best pump in Eagle Ford", evidence) === null);
  check("non-best question -> null", buildBestPumpStatements("How many days did DBO-31 run in Middle Spraberry pump", evidence) === null);

  // tie: two Middle Spraberry cases with equal days list both
  const tied = evidence.map((e) =>
    e.id.endsWith("/cases/ACS-1228") ? { ...e, text: e.text.replace("days_run=292", "days_run=517") } : e,
  );
  const t = buildBestPumpStatements(Q, tied);
  check("tie lists both winners", !!t && t[0].text.includes("AS-1508") && t[0].text.includes("ACS-1228"), JSON.stringify(t?.[0]));

  // number gate still applies: a tampered statement is dropped (stored number mismatch)
  const tampered = evidence.map((e) => (e.id.endsWith("/cases/AS-1508") ? { ...e, text: e.text.replace("pump_bore_in=1.25", "pump_bore_in=1.5") } : e));
  const stmts = buildBestPumpStatements(Q, tampered)!;
  check("statements copy stored values verbatim", stmts.some((s) => s.text === "Diameter: 1.5 in"), JSON.stringify(stmts.map((s) => s.text)));

  if (failed > 0) throw new Error(`${failed} recommend case(s) failed`);
  console.log("recommend fixtures passed");
})().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
