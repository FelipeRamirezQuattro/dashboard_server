import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.model";
import logger from "../utils/logger";

export type BrainAuditAction =
  | "BRAIN_DOCUMENT_UPLOADED"
  | "BRAIN_DOCUMENT_STATUS_CHANGED"
  | "BRAIN_DATASET_IMPORT_DRYRUN"
  | "BRAIN_DATASET_IMPORT_COMMITTED"
  | "BRAIN_DATASET_IMPORT_ROLLED_BACK"
  | "BRAIN_ACCESS_DENIED"
  | "BRAIN_ANSWER_INSUFFICIENT_EVIDENCE";

const ALLOWED_KEYS = [
  "requestId",
  "categoryId",
  "documentId",
  "importBatchId",
  "status",
  "counts",
  "rows",
  "issues",
] as const;
const MAX_STRING_LENGTH = 80;

/** Allowlist: ids and counts only. Objects, long strings and non-primitives are dropped. */
export const pickBrainAuditMetadata = (
  meta: Record<string, unknown> = {},
): Record<string, string | number | boolean> => {
  const out: Record<string, string | number | boolean> = {};
  for (const key of ALLOWED_KEYS) {
    const value = meta[key];
    if (typeof value === "string") {
      if (value.length <= MAX_STRING_LENGTH) out[key] = value;
    } else if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === "boolean") {
      out[key] = value;
    }
  }
  return out;
};

interface BrainAuditInput {
  userId?: string;
  action: BrainAuditAction;
  target: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export const recordBrainAudit = async ({
  userId,
  action,
  target,
  metadata,
  ipAddress,
  userAgent,
}: BrainAuditInput): Promise<void> => {
  try {
    await AuditLog.create({
      userId: userId && mongoose.isValidObjectId(userId) ? new mongoose.Types.ObjectId(userId) : undefined,
      action,
      target,
      metadata: pickBrainAuditMetadata(metadata),
      ipAddress,
      userAgent,
    });
  } catch (error) {
    // Message only: never log the metadata or any content.
    logger.error(`Failed to create brain audit log: ${error instanceof Error ? error.message : "unknown error"}`);
  }
};
