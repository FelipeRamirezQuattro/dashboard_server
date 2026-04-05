import mongoose, { Schema, Document } from "mongoose";

export type NotificationType =
  | "app_released"
  | "app_stopped"
  | "app_updated"
  | "maintenance"
  | "announcement"
  | "custom";

export type NotificationSeverity = "info" | "success" | "warning" | "error";

export type NotificationScope = "all" | "businessUnit" | "department";

export interface INotification extends Document {
  type: NotificationType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  targetScope: NotificationScope;
  targetId?: mongoose.Types.ObjectId;
  relatedAppId?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  isActive: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    type: {
      type: String,
      enum: [
        "app_released",
        "app_stopped",
        "app_updated",
        "maintenance",
        "announcement",
        "custom",
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1000,
    },
    severity: {
      type: String,
      enum: ["info", "success", "warning", "error"],
      default: "info",
    },
    targetScope: {
      type: String,
      enum: ["all", "businessUnit", "department"],
      default: "all",
    },
    targetId: {
      type: Schema.Types.ObjectId,
    },
    relatedAppId: {
      type: Schema.Types.ObjectId,
      ref: "ExternalApp",
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    expiresAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

notificationSchema.index({ isActive: 1, createdAt: -1 });
notificationSchema.index({ targetScope: 1, targetId: 1 });

notificationSchema.set("toJSON", {
  transform: (_doc, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

const Notification = mongoose.model<INotification>(
  "Notification",
  notificationSchema,
);

export default Notification;
