import mongoose, { Schema, Document } from "mongoose";

export type AppCategory =
  | "gas"
  | "chemical"
  | "sand"
  | "pumps"
  | "admin"
  | "other";
export type RequiredRole = "viewer" | "editor" | "admin" | "superadmin";

export interface IExternalApp extends Document {
  name: string;
  description: string;
  url: string;
  ssoEndpoint?: string;
  iconUrl?: string;
  category: AppCategory;
  requiredRole: RequiredRole;
  businessUnitId: mongoose.Types.ObjectId;
  departmentId: mongoose.Types.ObjectId;
  isActive: boolean;
  comingSoon?: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const externalAppSchema = new Schema<IExternalApp>(
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
    url: {
      type: String,
      required: true,
      trim: true,
    },
    ssoEndpoint: {
      type: String,
      trim: true,
    },
    iconUrl: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      enum: ["gas", "chemical", "sand", "pumps", "admin", "other"],
      required: true,
      default: "other",
    },
    requiredRole: {
      type: String,
      enum: ["viewer", "editor", "admin", "superadmin"],
      required: true,
      default: "viewer",
    },
    businessUnitId: {
      type: Schema.Types.ObjectId,
      ref: "BusinessUnit",
      required: true,
      index: true,
    },
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "Department",
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    comingSoon: {
      type: Boolean,
      default: false,
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
externalAppSchema.index({ category: 1, isActive: 1 });
externalAppSchema.index({ isActive: 1, requiredRole: 1 });
externalAppSchema.index({ businessUnitId: 1, isActive: 1 });
externalAppSchema.index({ departmentId: 1, isActive: 1 });

// Transform output
externalAppSchema.set("toJSON", {
  transform: (_doc, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

const ExternalApp = mongoose.model<IExternalApp>(
  "ExternalApp",
  externalAppSchema,
);

export default ExternalApp;
