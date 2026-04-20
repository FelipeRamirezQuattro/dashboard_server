/**
 * One-time migration: backfill searchText for existing FileBank documents.
 *
 * Usage:  npx ts-node src/seeds/backfillFileBankSearchText.ts
 *
 * Safe to run multiple times — it only updates docs where searchText is empty.
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import FileBank from "../models/FileBank.model";

async function backfill() {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    console.error("MONGODB_URI not set in .env");
    process.exit(1);
  }

  await mongoose.connect(mongoUri);
  console.log("Connected to MongoDB");

  const docs = await FileBank.find({
    $or: [{ searchText: { $exists: false } }, { searchText: "" }],
  });

  console.log(`Found ${docs.length} documents to backfill`);

  for (const doc of docs) {
    // The pre-save hook will generate searchText automatically
    await doc.save();
    console.log(`  ✓ ${doc.originalName}`);
  }

  console.log("Backfill complete");
  await mongoose.disconnect();
}

backfill().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
