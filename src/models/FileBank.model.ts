import mongoose, { Schema, Document } from "mongoose";

export interface IFileBank extends Document {
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  description: string;
  tags: string[];
  searchText: string;
  contentText?: string;
  source: "local" | "onedrive";
  externalId?: string;
  webUrl?: string;
  indexedAt?: Date;
  lastModifiedAt?: Date;
  syncStatus: "indexed" | "failed" | "pending";
  syncError?: string;
  uploadedBy: string;
  uploadedAt: Date;
  filePath: string;
  downloadUrl: string;
}

const fileBankSchema = new Schema<IFileBank>({
  originalName: { type: String, required: true, trim: true },
  storedName: { type: String, required: true, unique: true },
  mimeType: { type: String, required: true },
  sizeBytes: { type: Number, required: true },
  description: { type: String, required: true, trim: true },
  tags: [{ type: String, trim: true }],
  searchText: { type: String, default: "" },
  contentText: { type: String, default: "" },
  source: {
    type: String,
    enum: ["local", "onedrive"],
    default: "local",
    index: true,
  },
  externalId: { type: String, trim: true, index: true },
  webUrl: { type: String, trim: true },
  indexedAt: { type: Date },
  lastModifiedAt: { type: Date },
  syncStatus: {
    type: String,
    enum: ["indexed", "failed", "pending"],
    default: "indexed",
  },
  syncError: { type: String, trim: true },
  uploadedBy: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  filePath: { type: String, default: "" },
  downloadUrl: { type: String, required: true },
});

// Full-text search index on searchText for chatbot file lookups
fileBankSchema.index({
  originalName: "text",
  description: "text",
  tags: "text",
  searchText: "text",
  contentText: "text",
});
fileBankSchema.index(
  { source: 1, externalId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      source: "onedrive",
      externalId: { $exists: true, $type: "string" },
    },
  },
);

// Auto-generate searchText before saving so it stays in sync
fileBankSchema.pre("save", function (next) {
  const nameWithoutExt = this.originalName.replace(/\.[^.]+$/, "");
  this.searchText = [
    nameWithoutExt,
    this.description,
    ...this.tags,
    this.contentText || "",
  ]
    .filter(Boolean)
    .join(" ");
  next();
});

fileBankSchema.set("toJSON", {
  transform: (_doc, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

const FileBank = mongoose.model<IFileBank>("FileBank", fileBankSchema);
export default FileBank;
