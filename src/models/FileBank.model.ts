import mongoose, { Schema, Document } from "mongoose";

export interface IFileBank extends Document {
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  description: string;
  tags: string[];
  searchText: string;
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
  uploadedBy: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  filePath: { type: String, required: true },
  downloadUrl: { type: String, required: true },
});

// Full-text search index on searchText for chatbot file lookups
fileBankSchema.index({ searchText: "text" });

// Auto-generate searchText before saving so it stays in sync
fileBankSchema.pre("save", function (next) {
  const nameWithoutExt = this.originalName.replace(/\.[^.]+$/, "");
  this.searchText = [nameWithoutExt, this.description, ...this.tags]
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
