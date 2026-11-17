import mongoose, { Document, Schema } from "mongoose";
import type { DocKind } from "../services/brain/documentParser";

const objectId = Schema.Types.ObjectId;
type Oid = mongoose.Types.ObjectId;
export type BrainEmbeddingStatus = "none" | "pending" | "done" | "failed";

const stripVersion = {
  transform: (_doc: unknown, ret: any) => {
    delete ret.__v;
    return ret;
  },
};

// ---------- BrainDocument ----------
export interface IBrainDocumentFlag {
  id: string;
  line: number;
  excerpt: string;
  acknowledged: boolean;
}

export interface IBrainDocument extends Document {
  categoryId: Oid;
  title: string;
  kind: DocKind;
  version?: string;
  status: "draft" | "active" | "archived";
  sourceFormat: "md" | "pdf";
  contentHash: string;
  sizeBytes: number;
  fileBankId?: Oid;
  flags: IBrainDocumentFlag[];
  tags: string[];
  source?: string;
  chunkCount: number;
  embeddingStatus: BrainEmbeddingStatus;
  uploadedBy: Oid;
  activatedBy?: Oid;
  activatedAt?: Date;
  supersededById?: Oid;
  createdAt: Date;
  updatedAt: Date;
}

const embeddingStatusEnum = ["none", "pending", "done", "failed"];

const documentSchema = new Schema<IBrainDocument>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 240 },
    kind: { type: String, enum: ["facts", "guidance", "glossary", "procedure"], required: true },
    version: { type: String, trim: true },
    status: { type: String, enum: ["draft", "active", "archived"], default: "draft" },
    sourceFormat: { type: String, enum: ["md", "pdf"], required: true },
    contentHash: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    sizeBytes: { type: Number, required: true, min: 0 },
    fileBankId: { type: objectId, ref: "FileBank" },
    flags: {
      type: [
        new Schema(
          {
            id: { type: String, required: true },
            line: { type: Number, required: true },
            excerpt: { type: String, required: true },
            acknowledged: { type: Boolean, default: false },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    tags: { type: [String], default: [] },
    source: { type: String },
    chunkCount: { type: Number, default: 0, min: 0 },
    embeddingStatus: { type: String, enum: embeddingStatusEnum, default: "none" },
    uploadedBy: { type: objectId, ref: "User", required: true },
    activatedBy: { type: objectId, ref: "User" },
    activatedAt: { type: Date },
    supersededById: { type: objectId, ref: "BrainDocument" },
  },
  { timestamps: true },
);
documentSchema.index({ categoryId: 1, contentHash: 1 }, { unique: true });

// ---------- BrainDatasetDefinitionRecord ----------
export interface IBrainDatasetDefinitionRecord extends Document {
  categoryId: Oid;
  key: string;
  version: string;
  definition: unknown;
  updatedBy: Oid;
  createdAt: Date;
  updatedAt: Date;
}

const definitionSchema = new Schema<IBrainDatasetDefinitionRecord>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true },
    key: { type: String, required: true, trim: true },
    version: { type: String, required: true, trim: true },
    definition: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: objectId, ref: "User", required: true },
  },
  { timestamps: true },
);
definitionSchema.index({ categoryId: 1, key: 1 }, { unique: true });

// ---------- BrainImportBatch ----------
export interface IBrainImportBatch extends Document {
  categoryId: Oid;
  datasetKey: string;
  datasetVersion: string;
  status: "dry_run" | "committed" | "rolled_back";
  report: unknown; // counts and issues only, never row data
  files?: Record<string, string>; // raw CSV text by file name, kept only while dry_run
  fileHashes: Record<string, string>;
  embeddingStatus: BrainEmbeddingStatus;
  createdBy: Oid;
  committedBy?: Oid;
  committedAt?: Date;
  expiresAt?: Date; // TTL: dry-run batches expire; committing must $unset this
  createdAt: Date;
  updatedAt: Date;
}

const importBatchSchema = new Schema<IBrainImportBatch>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true, index: true },
    datasetKey: { type: String, required: true },
    datasetVersion: { type: String, required: true },
    status: { type: String, enum: ["dry_run", "committed", "rolled_back"], required: true },
    report: { type: Schema.Types.Mixed, default: {} },
    files: { type: Schema.Types.Mixed },
    fileHashes: { type: Schema.Types.Mixed, default: {} },
    embeddingStatus: { type: String, enum: embeddingStatusEnum, default: "none" },
    createdBy: { type: objectId, ref: "User", required: true },
    committedBy: { type: objectId, ref: "User" },
    committedAt: { type: Date },
    expiresAt: { type: Date },
  },
  { timestamps: true },
);
importBatchSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ---------- BrainDatasetRecord ----------
export interface IBrainDatasetRecord extends Document {
  categoryId: Oid;
  datasetKey: string;
  table: string;
  primaryKeyValue: string;
  data: Record<string, unknown>;
  cardText?: string;
  embedding?: number[];
  embeddingModel?: string;
  embeddingVersion?: string;
  embeddedAt?: Date;
  importBatchId: Oid;
  revision: number;
  status: "active" | "superseded" | "rolled_back";
  createdAt: Date;
  updatedAt: Date;
}

const datasetRecordSchema = new Schema<IBrainDatasetRecord>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true },
    datasetKey: { type: String, required: true },
    table: { type: String, required: true },
    primaryKeyValue: { type: String, required: true },
    data: { type: Schema.Types.Mixed, required: true },
    cardText: { type: String },
    embedding: { type: [Number], select: false },
    embeddingModel: { type: String },
    embeddingVersion: { type: String },
    embeddedAt: { type: Date },
    importBatchId: { type: objectId, ref: "BrainImportBatch", required: true },
    revision: { type: Number, default: 1 },
    status: { type: String, enum: ["active", "superseded", "rolled_back"], default: "active" },
  },
  { timestamps: true },
);
datasetRecordSchema.index({ categoryId: 1, datasetKey: 1, table: 1, primaryKeyValue: 1, revision: 1 });
datasetRecordSchema.index({ categoryId: 1, datasetKey: 1, status: 1 });

[documentSchema, definitionSchema, importBatchSchema, datasetRecordSchema].forEach((schema) =>
  schema.set("toJSON", stripVersion),
);

export const BrainDocument = mongoose.model<IBrainDocument>("BrainDocument", documentSchema);
export const BrainDatasetDefinitionRecord = mongoose.model<IBrainDatasetDefinitionRecord>(
  "BrainDatasetDefinitionRecord",
  definitionSchema,
);
export const BrainImportBatch = mongoose.model<IBrainImportBatch>("BrainImportBatch", importBatchSchema);
export const BrainDatasetRecord = mongoose.model<IBrainDatasetRecord>(
  "BrainDatasetRecord",
  datasetRecordSchema,
);
