/// <reference types="node" />
/**
 * Removes ONLY the demo data loaded by seedRodPumpDemo (batches whose files hash-match the embedded demo CSVs, and
 * their records). Real data imported later is never touched.
 *
 *   npm run brain:rodpump-unseed                       preview (deletes nothing)
 *   npm run brain:rodpump-unseed -- --yes              delete demo batches + records
 *   npm run brain:rodpump-unseed -- --yes --drop-category   also delete the category if nothing else remains in it
 *
 * Not touched: documents (.md/.pdf) uploaded by testers (archive them in the Knowledge tab), File Bank files.
 */
import mongoose from "mongoose";
import { env } from "../config/env";
import { BrainDatasetRecord, BrainDocument, BrainImportBatch } from "../models/BrainKnowledge.model";
import { WorkflowBrainCategory } from "../models/WorkflowBrain.model";
import { rodPumpFailureDefinition } from "../services/brain/definitions/rodPumpFailure";
import { ROD_PUMP_CATEGORY_NAME } from "./registerRodPumpBrain";
import { findDemoBatches } from "./seedRodPumpDemo";

const main = async (): Promise<void> => {
  if (!env.mongodbUri) throw new Error("MONGODB_URI is not configured.");
  const yes = process.argv.includes("--yes");
  const dropCategory = process.argv.includes("--drop-category");
  await mongoose.connect(env.mongodbUri);
  try {
    const cats = await WorkflowBrainCategory.find({ name: ROD_PUMP_CATEGORY_NAME }).select("_id").lean();
    if (cats.length !== 1) {
      console.log(`Expected exactly one "${ROD_PUMP_CATEGORY_NAME}" category, found ${cats.length}. Nothing done.`);
      process.exitCode = cats.length ? 1 : 0;
      return;
    }
    const categoryId = String(cats[0]._id);
    const demo = await findDemoBatches(categoryId);
    const batchIds = demo.map((b) => b._id);
    const recordCount = await BrainDatasetRecord.countDocuments({ importBatchId: { $in: batchIds } });
    const allBatches = await BrainImportBatch.countDocuments({ categoryId, datasetKey: rodPumpFailureDefinition.key });
    const docs = await BrainDocument.countDocuments({ categoryId });
    console.log(`Demo batches: ${demo.length} (of ${allBatches} dataset batches in the category); demo records: ${recordCount}; documents in category: ${docs} (not touched)`);
    if (!yes) {
      console.log("Preview only. Re-run with --yes to delete.");
      return;
    }
    const delRecords = await BrainDatasetRecord.deleteMany({ importBatchId: { $in: batchIds } });
    const delBatches = await BrainImportBatch.deleteMany({ _id: { $in: batchIds } });
    console.log(`Deleted ${delRecords.deletedCount} records and ${delBatches.deletedCount} batches.`);

    if (dropCategory) {
      const leftRecords = await BrainDatasetRecord.countDocuments({ categoryId });
      const leftBatches = await BrainImportBatch.countDocuments({ categoryId });
      if (leftRecords || leftBatches || docs) {
        console.log(`Category kept: it still has ${leftRecords} records, ${leftBatches} batches, ${docs} documents.`);
      } else {
        await WorkflowBrainCategory.deleteOne({ _id: cats[0]._id });
        console.log("Category deleted.");
      }
    } else {
      console.log("Category kept, ready for real data.");
    }
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Rod Pump demo unseed failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  });
}
