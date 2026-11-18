/// <reference types="node" />
// Shared fixture helper (not a fixture itself): the Rod Pump sample CSVs as active dataset records, plus fake
// retrieval ports. Nothing here touches a database or the network.
import fs from "fs";
import path from "path";
import { validateDataset } from "../../services/brain/datasetValidator";
import { rodPumpFailureDefinition } from "../../services/brain/definitions/rodPumpFailure";
import { buildRecordCards, primaryKeyValueOf } from "../../services/brain/recordCards";
import type { ChunkLite, DocumentLite, RecordLite, RetrievalPorts } from "../../services/brain/retrieval";
import type { DatasetDefinition } from "../../services/brain/types";

export const SAMPLE_DIR = path.resolve(__dirname, "../../../../docs/rod-pump-failure-sample-data");

export const loadSampleFiles = (): Record<string, string> => {
  const files: Record<string, string> = {};
  for (const n of ["cases", "components", "wear", "solids", "actions", "evidence"]) {
    files[`${n}.csv`] = fs.readFileSync(path.join(SAMPLE_DIR, `${n}.csv`), "utf8");
  }
  return files;
};

/** Sample rows (optionally edited) as active BrainDatasetRecord-like objects; root cards carry their card text. */
export const sampleRecords = (
  edit?: (rows: Record<string, Record<string, unknown>[]>) => void,
): RecordLite[] => {
  const def = rodPumpFailureDefinition;
  const report = validateDataset(def, loadSampleFiles());
  if (!report.canCommit) throw new Error("sample data must commit");
  const rows = JSON.parse(JSON.stringify(report.rows)) as Record<string, Record<string, unknown>[]>;
  edit?.(rows);
  const cardText = new Map(buildRecordCards(def, rows).map((c) => [c.primaryKeyValue, c.text]));
  const out: RecordLite[] = [];
  for (const t of def.tables) {
    for (const row of rows[t.name] ?? []) {
      const pk = primaryKeyValueOf(t, row);
      out.push({
        datasetKey: def.key,
        table: t.name,
        primaryKeyValue: pk,
        data: row,
        status: "active",
        ...(t.name === def.card?.rootTable ? { cardText: cardText.get(pk) } : {}),
      });
    }
  }
  return out;
};

export interface FakeWorld {
  documents?: DocumentLite[];
  chunks?: ChunkLite[];
  records?: RecordLite[];
  definitions?: DatasetDefinition[];
  identity?: { model: string; version: string } | null;
  embed?: (q: string) => Promise<number[] | null>;
}

/** Fake ports over in-memory data. Like the real ports they return what they are given (the status filter is the
 * retrieval code's job, which is exactly what the fixtures check by handing it non-active parents). */
export const fakePorts = (w: FakeWorld): RetrievalPorts & { embedCalls: number } => {
  const ports = {
    embedCalls: 0,
    loadActiveDocuments: async () => w.documents ?? [],
    // deliberately ignores the ids: retrieval must still drop chunks of non-active documents itself
    loadChunks: async (_ids: string[]) => w.chunks ?? [],
    loadActiveRecords: async () => w.records ?? [],
    loadDefinitions: async (_c: string, keys: string[]) =>
      (w.definitions ?? [rodPumpFailureDefinition]).filter((d) => keys.includes(d.key)),
    embeddingIdentity: () => (w.identity === undefined ? null : w.identity),
    embedQuestion: async (q: string) => {
      ports.embedCalls += 1;
      return w.embed ? w.embed(q) : null;
    },
  };
  return ports;
};

const SP = "ds:rod_pump_failure/";
/** Off-topic questions that share one generic domain word with the sample data (review r8). */
export const OFF_TOPIC = [
  "what is the run time of my washing machine",
  "how long should I run today",
  "what wear should I put on for a wedding",
  "what action movies are good",
  "tell me about solids in baby food",
  "what pump should I buy for my aquarium",
];
/** Legitimate questions and one row id each must retrieve. */
export const LEGIT: [string, string][] = [
  ["why did DEMO-001 fail?", `${SP}cases/DEMO-001`],
  ["which cases had paraffin evidence?", `${SP}solids/DEMO-002|hydrocarbon_paraffin`],
  ["what wear readings were recorded for the plunger?", `${SP}wear/DEMO-001|plunger_in|0`],
  ["how many days did DEMO-002 run?", `${SP}cases/DEMO-002`],
  ["what failure modes were seen?", `${SP}components/DEMO-001-plunger`],
];
