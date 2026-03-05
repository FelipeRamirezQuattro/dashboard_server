import mongoose, { Schema, Document } from "mongoose";

export interface IDepartment extends Document {
  name: string;
  description: string;
  businessUnitId: mongoose.Types.ObjectId;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const departmentSchema = new Schema<IDepartment>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    businessUnitId: {
      type: Schema.Types.ObjectId,
      ref: "BusinessUnit",
      required: true,
      index: true,
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
departmentSchema.index({ businessUnitId: 1, isActive: 1 });
departmentSchema.index({ name: 1, businessUnitId: 1 }, { unique: true }); // Unique within BU

// Transform output
departmentSchema.set("toJSON", {
  transform: (_doc, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

const Department = mongoose.model<IDepartment>("Department", departmentSchema);

export default Department;
