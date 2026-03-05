import mongoose, { Schema, Document } from "mongoose";

export interface IBusinessUnit extends Document {
  name: string;
  description: string;
  logoUrl?: string;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const businessUnitSchema = new Schema<IBusinessUnit>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    logoUrl: {
      type: String,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient queries
businessUnitSchema.index({ name: 1 });
businessUnitSchema.index({ isActive: 1 });

// Transform output
businessUnitSchema.set("toJSON", {
  transform: (_doc, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

const BusinessUnit = mongoose.model<IBusinessUnit>(
  "BusinessUnit",
  businessUnitSchema,
);

export default BusinessUnit;
