/// <reference types="node" />
/**
 * Seeds the fictional Rod Pump Failure demo data (DEMO-001..003) into the configured database, through the same
 * validate -> commit path the UI uses. Safe to repeat: it does nothing if the demo is already loaded.
 *
 *   npm run brain:rodpump-seed -- --dry    validate only, write nothing
 *   npm run brain:rodpump-seed             create category (if missing) + load demo data
 *
 * Remove it afterwards with `npm run brain:rodpump-unseed`.
 */
import crypto from "crypto";
import mongoose from "mongoose";
import { env } from "../config/env";
import { BrainImportBatch } from "../models/BrainKnowledge.model";
import { commitImport, dryRunImport } from "../services/brain/datasets.service";
import { rodPumpFailureDefinition } from "../services/brain/definitions/rodPumpFailure";
import { ROD_PUMP_CATEGORY_NAME, mongoPorts, runBootstrap } from "./registerRodPumpBrain";
import { RODPUMP_DEMO_FILES } from "./demoData/rodPumpDemo";

export const demoFileHashes = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(RODPUMP_DEMO_FILES).map(([name, text]) => [name, crypto.createHash("sha256").update(text).digest("hex")]),
  );

/** Batches that were created from exactly the embedded demo files (identified by content hash). */
export const findDemoBatches = async (categoryId: string) => {
  const hashes = demoFileHashes();
  const batches = await BrainImportBatch.find({ categoryId, datasetKey: rodPumpFailureDefinition.key })
    .select("status fileHashes committedAt")
    .lean();
  return batches.filter((b) => {
    const h = (b.fileHashes ?? {}) as Record<string, string>;
    return Object.keys(hashes).every((k) => h[k] === hashes[k]);
  });
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const waitForEmbedding = async (batchId: string): Promise<string> => {
  for (let i = 0; i < 60; i++) {
    const b = await BrainImportBatch.findById(batchId).select("embeddingStatus").lean();
    if (b && (b.embeddingStatus === "done" || b.embeddingStatus === "failed")) return b.embeddingStatus;
    await sleep(1000);
  }
  return "pending";
};

const main = async (): Promise<void> => {
  if (!env.mongodbUri) throw new Error("MONGODB_URI is not configured.");
  const dry = process.argv.includes("--dry");
  await mongoose.connect(env.mongodbUri);
  try {
    const ports = mongoPorts();
    const userId = await ports.findAdminUserId();
    if (!userId) throw new Error("No superadmin or admin user found.");

    const boot = await runBootstrap(ports);
    if (boot.status === "drift") {
      console.error(`Category "${ROD_PUMP_CATEGORY_NAME}" exists with different settings (${boot.drift.join(", ")}). Fix in the Brain UI, then re-run.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Category "${ROD_PUMP_CATEGORY_NAME}" ${boot.status} (id=${boot.categoryId})`);

    const existing = (await findDemoBatches(boot.categoryId)).filter((b) => b.status === "committed");
    if (existing.length) {
      console.log("Demo data is already loaded (committed batch found). Nothing to do.");
      return;
    }

    const { importId, report } = await dryRunImport({
      categoryId: boot.categoryId,
      datasetKey: rodPumpFailureDefinition.key,
      files: RODPUMP_DEMO_FILES,
      userId,
    });
    console.log(`Validated: ${report.issueTotal} issue(s); canCommit=${report.canCommit}`);
    if (!report.canCommit) {
      console.error("The demo files have rejected rows; not committing.");
      await BrainImportBatch.deleteOne({ _id: importId, status: "dry_run" });
      process.exitCode = 1;
      return;
    }
    if (dry) {
      await BrainImportBatch.deleteOne({ _id: importId, status: "dry_run" });
      console.log("--dry: nothing was written.");
      return;
    }
    const res = await commitImport({ importId, acknowledgeWarnings: true, userId });
    console.log(`Committed ${res.committed} records. Waiting for embeddings...`);
    const emb = await waitForEmbedding(importId);
    console.log(`Embedding status: ${emb}${emb === "done" ? "" : " (keyword search still works; run Reindex in the Knowledge tab once OPENAI_API_KEY is set)"}`);
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Rod Pump demo seed failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  });
}
