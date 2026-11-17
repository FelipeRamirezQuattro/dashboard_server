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
  createLimiter,
  resolveDatasetJobOutcome,
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

const limit = createLimiter(2);
type JobFn = (force: boolean) => Promise<void>;
const queued = new Map<string, { force: boolean; jobs: JobFn[] }>();

/** Guarded, concurrency-limited run. Calls arriving mid-run are remembered and re-run once afterwards. */
const startGuarded = (key: string, kind: string, id: string, force: boolean, job: JobFn): void => {
  if (!guard.tryAcquire(key)) {
    const q = queued.get(key) ?? { force: false, jobs: [] };
    q.force = q.force || force;
    q.jobs.push(job);
    queued.set(key, q);
    return;
  }
  limit(() => job(force))
    .catch((e: unknown) => logFail(kind, id, e instanceof Error ? e.name : "Error"))
    .finally(() => {
      if (!guard.release(key)) return;
      const q = queued.get(key);
      queued.delete(key);
      if (!q) return;
      const [first, ...rest] = q.jobs;
      startGuarded(key, kind, id, q.force, async (f) => {
        await first(f);
        for (const j of rest) await j(false);
      });
    });
};

const runGuarded = (key: string, kind: string, id: string, force: boolean, job: JobFn): void => {
  setImmediate(() => startGuarded(key, kind, id, force, job));
};

// ------------------------------------------------------------------ documents

const runDocumentJob = async (documentId: string, force: boolean): Promise<void> => {
  const doc = await BrainDocument.findById(documentId).select("status").lean();
  if (!doc || doc.status !== "active") return; // chunks carry no status of their own: parent must be active
  await BrainDocument.updateOne({ _id: doc._id }, { $set: { embeddingStatus: "pending" } });
  // a stale run must not overwrite a newer state: only finish what this run started
  const setStatus = (s: Status) =>
    BrainDocument.updateOne({ _id: doc._id, embeddingStatus: "pending" }, { $set: { embeddingStatus: s } });
  try {
    const provider = getEmbeddingProvider();
    const chunks = await BrainMemory.find({ documentId: doc._id, type: "document_chunk" })
      .select("heading content embeddingModel embeddingVersion embeddedAt")
      .lean();
    const items: EmbeddingJobItem[] = chunks.map((c) => ({
      id: String(c._id),
      text: buildChunkEmbeddingText(c.heading, c.content),
      current: force ? undefined : c,
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
    runGuarded(`doc:${documentId}`, "document", documentId, !!opts.force, (f) => runDocumentJob(documentId, f));
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
  const outcome = resolveDatasetJobOutcome(def);
  if (outcome === "failed") {
    logger.warn(`brain embedding job failed kind=dataset id=${categoryId} datasetKey=${datasetKey} error=MissingDefinition`);
    return "failed";
  }
  if (outcome === "skip_done" || !def || !def.card) return "done"; // no card: nothing to embed
  const rootTable = def.card.rootTable;
  const all = await BrainDatasetRecord.find({ categoryId: oid(categoryId), datasetKey, status: "active" })
    .select("table primaryKeyValue data cardText embeddingModel embeddingVersion embeddedAt")
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
    items.push({ id, text: c.text, current: !force && root.cardText === c.text ? root : undefined });
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
  await BrainImportBatch.updateOne({ _id: batch._id }, { $set: { embeddingStatus: "pending" } });
  const setStatus = (s: Status) =>
    BrainImportBatch.updateOne({ _id: batch._id, embeddingStatus: "pending" }, { $set: { embeddingStatus: s } });
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
    setImmediate(async () => {
      try {
        const b = await BrainImportBatch.findById(batchId).select("categoryId datasetKey").lean();
        if (!b) return;
        // dataset-level job: one at a time per (category, dataset)
        const key = `ds:${String(b.categoryId)}/${b.datasetKey}`;
        startGuarded(key, "batch", batchId, !!opts.force, (f) => runBatchJob(batchId, f));
      } catch (e) {
        logFail("batch", batchId, e instanceof Error ? e.name : "Error");
      }
    });
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
