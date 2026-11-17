import mongoose from "mongoose";
import {
  BrainDatasetDefinitionRecord,
  BrainDatasetRecord,
  BrainDocument,
  BrainImportBatch,
} from "../../models/BrainKnowledge.model";
import { BrainMemory } from "../../models/WorkflowBrain.model";
import logger from "../../utils/logger";
import { builtinDefinitions } from "./datasets.service";
import { EmbeddingProvider, getEmbeddingProvider } from "./embeddingProvider";
import {
  EmbeddingJobItem,
  buildChunkEmbeddingText,
  createJobGuard,
  rebuildCardsFromActiveRecords,
  runEmbeddingJob,
  selectActiveRecords,
} from "./indexerCore";
import { DatasetDefinition } from "./types";

export * from "./indexerCore";

export interface ScheduleOptions {
  /** Re-embed even when the item is already current (reindex). */
  force?: boolean;
}

const guard = createJobGuard();
const oid = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id);
const logFail = (kind: string, id: string, errorName: string): void => {
  // ids and error class names only: never content, vectors or prompts
  logger.warn(`brain embedding job failed kind=${kind} id=${id} error=${errorName}`);
};

type Status = "pending" | "done" | "failed";

const runGuarded = (key: string, kind: string, id: string, job: () => Promise<void>): void => {
  setImmediate(() => {
    if (!guard.tryAcquire(key)) return;
    job()
      .catch((e: unknown) => logFail(kind, id, e instanceof Error ? e.name : "Error"))
      .finally(() => guard.release(key));
  });
};

// ------------------------------------------------------------------ documents

const runDocumentJob = async (documentId: string, force: boolean): Promise<void> => {
  const doc = await BrainDocument.findById(documentId).select("status").lean();
  if (!doc || doc.status !== "active") return; // chunks carry no status of their own: parent must be active
  const setStatus = (s: Status) => BrainDocument.updateOne({ _id: doc._id }, { $set: { embeddingStatus: s } });
  await setStatus("pending");
  try {
    const provider = getEmbeddingProvider();
    const chunks = await BrainMemory.find({ documentId: doc._id, type: "document_chunk" })
      .select("+embedding heading content embeddingModel embeddingVersion")
      .lean();
    const items: EmbeddingJobItem[] = chunks.map((c) => ({
      id: String(c._id),
      text: buildChunkEmbeddingText(c.heading, c.content),
      current: c,
    }));
    const result = await runEmbeddingJob({
      items,
      provider,
      force,
      write: async (writes) => {
        await BrainMemory.bulkWrite(
          writes.map((w) => ({
            updateOne: {
              filter: { _id: oid(w.id) },
              update: {
                $set: {
                  embedding: w.embedding,
                  embeddingModel: w.embeddingModel,
                  embeddingVersion: w.embeddingVersion,
                  embeddedAt: new Date(),
                },
              },
            },
          })),
        );
      },
    });
    if (result.status === "failed" && result.errorName !== "NoProvider") logFail("document", documentId, result.errorName ?? "Error");
    await setStatus(result.status);
  } catch (e) {
    logFail("document", documentId, e instanceof Error ? e.name : "Error");
    await setStatus("failed").catch(() => undefined);
  }
};

export const scheduleDocumentEmbedding = (documentId: string, opts: ScheduleOptions = {}): void => {
  try {
    runGuarded(`doc:${documentId}`, "document", documentId, () => runDocumentJob(documentId, !!opts.force));
  } catch {
    /* fire-and-forget: never throws */
  }
};

// ------------------------------------------------------------------ datasets

const loadDefinition = async (categoryId: string, key: string): Promise<DatasetDefinition | null> => {
  const rec = await BrainDatasetDefinitionRecord.findOne({ categoryId: oid(categoryId), key }).lean();
  if (rec) return rec.definition as DatasetDefinition;
  return builtinDefinitions.find((d) => d.key === key) ?? null;
};

/** Dataset-wide job keyed by (categoryId, datasetKey): rebuilds root cards from ACTIVE records, then embeds. */
const embedDataset = async (
  categoryId: string,
  datasetKey: string,
  provider: EmbeddingProvider | null,
  force: boolean,
): Promise<"done" | "failed"> => {
  const def = await loadDefinition(categoryId, datasetKey);
  if (!def || !def.card) return "done"; // nothing to embed for this dataset
  const rootTable = def.card.rootTable;
  const all = await BrainDatasetRecord.find({ categoryId: oid(categoryId), datasetKey, status: "active" })
    .select("+embedding table primaryKeyValue data cardText embeddingModel embeddingVersion")
    .lean();
  const active = selectActiveRecords(all);
  const cards = rebuildCardsFromActiveRecords(def, active);
  const roots = new Map(active.filter((r) => r.table === rootTable).map((r) => [r.primaryKeyValue, r]));
  const idByCard = new Map<string, { id: string; text: string }>();
  const items: EmbeddingJobItem[] = [];
  for (const c of cards) {
    const root = roots.get(c.primaryKeyValue);
    if (!root) continue;
    const id = String(root._id);
    idByCard.set(id, { id, text: c.text });
    // a changed card text invalidates the stored embedding even when model/version match
    items.push({ id, text: c.text, current: root.cardText === c.text ? root : undefined });
  }
  const result = await runEmbeddingJob({
    items,
    provider,
    force,
    write: async (writes) => {
      await BrainDatasetRecord.bulkWrite(
        writes.map((w) => ({
          updateOne: {
            filter: { _id: oid(w.id) },
            update: {
              $set: {
                cardText: idByCard.get(w.id)!.text,
                embedding: w.embedding,
                embeddingModel: w.embeddingModel,
                embeddingVersion: w.embeddingVersion,
                embeddedAt: new Date(),
              },
            },
          },
        })),
      );
    },
  });
  if (result.status === "failed" && result.errorName !== "NoProvider") logFail("dataset", `${categoryId}/${datasetKey}`, result.errorName ?? "Error");
  return result.status;
};

const runBatchJob = async (batchId: string, force: boolean): Promise<void> => {
  const batch = await BrainImportBatch.findById(batchId).select("status categoryId datasetKey").lean();
  if (!batch || batch.status !== "committed") return;
  const setStatus = (s: Status) => BrainImportBatch.updateOne({ _id: batch._id }, { $set: { embeddingStatus: s } });
  await setStatus("pending");
  try {
    const status = await embedDataset(String(batch.categoryId), batch.datasetKey, getEmbeddingProvider(), force);
    await setStatus(status);
  } catch (e) {
    logFail("batch", batchId, e instanceof Error ? e.name : "Error");
    await setStatus("failed").catch(() => undefined);
  }
};

export const scheduleBatchEmbedding = (batchId: string, opts: ScheduleOptions = {}): void => {
  try {
    runGuarded(`batch:${batchId}`, "batch", batchId, () => runBatchJob(batchId, !!opts.force));
  } catch {
    /* fire-and-forget: never throws */
  }
};

// ------------------------------------------------------------------ reindex

/** Schedules a forced re-embed of every active document and every dataset (via its latest committed batch). */
export const reindexCategory = async (categoryId: string): Promise<{ documents: number; batches: number }> => {
  const cat = oid(categoryId);
  const docs = await BrainDocument.find({ categoryId: cat, status: "active" }).select("_id").lean();
  const committed = await BrainImportBatch.find({ categoryId: cat, status: "committed" })
    .sort({ committedAt: -1, createdAt: -1 })
    .select("_id datasetKey")
    .lean();
  const latest = new Map<string, string>();
  for (const b of committed) if (!latest.has(b.datasetKey)) latest.set(b.datasetKey, String(b._id));
  for (const d of docs) scheduleDocumentEmbedding(String(d._id), { force: true });
  for (const id of latest.values()) scheduleBatchEmbedding(id, { force: true });
  return { documents: docs.length, batches: latest.size };
};
