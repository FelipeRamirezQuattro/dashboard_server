import mongoose, { Schema, Document } from "mongoose";

export interface INotificationRead extends Document {
  userId: mongoose.Types.ObjectId;
  notificationId: mongoose.Types.ObjectId;
  readAt: Date;
}

const notificationReadSchema = new Schema<INotificationRead>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    notificationId: {
      type: Schema.Types.ObjectId,
      ref: "Notification",
      required: true,
    },
    readAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: false,
  },
);

notificationReadSchema.index(
  { userId: 1, notificationId: 1 },
  { unique: true },
);
notificationReadSchema.index({ userId: 1 });

const NotificationRead = mongoose.model<INotificationRead>(
  "NotificationRead",
  notificationReadSchema,
);

export default NotificationRead;
