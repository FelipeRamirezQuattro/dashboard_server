import mongoose, { Schema, Document } from "mongoose";

export interface IFileBank extends Document {
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  description: string;
  tags: string[];
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
  uploadedBy: { type: String, required: true },
  uploadedAt: { type: Date, default: Date.now },
  filePath: { type: String, required: true },
  downloadUrl: { type: String, required: true },
});

fileBankSchema.set("toJSON", {
  transform: (_doc, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

const FileBank = mongoose.model<IFileBank>("FileBank", fileBankSchema);
export default FileBank;
