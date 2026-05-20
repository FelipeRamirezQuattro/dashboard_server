import { Types } from "mongoose";
import Notification, {
  INotification,
  NotificationType,
  NotificationSeverity,
  NotificationScope,
} from "../models/Notification.model";
import NotificationRead from "../models/NotificationRead.model";
import UserPermission from "../models/UserPermission.model";
import * as notificationSSE from "./notificationSSE.service";

export interface CreateNotificationDto {
  type: NotificationType;
  title: string;
  message: string;
  severity?: NotificationSeverity;
  targetScope?: NotificationScope;
  targetId?: string;
  relatedAppId?: string;
  expiresAt?: Date;
}

export type NotificationWithRead = INotification & { isRead: boolean };

// Plain-object variant returned by lean queries
export type NotificationLean = Record<string, any> & { isRead: boolean };

export const createNotification = async (
  data: CreateNotificationDto,
  createdBy: string,
): Promise<INotification> => {
  const notification = await Notification.create({ ...data, createdBy });

  // Broadcast lightweight ping — clients re-fetch their scoped list
  notificationSSE.broadcast({
    type: "new_notification",
    notificationId: notification._id,
  });

  return notification;
};

export const getNotificationsForUser = async (
  userId: string,
): Promise<NotificationLean[]> => {
  // Resolve which BUs and departments this user has explicit permissions for
  const permissions = await UserPermission.find({ userId }).lean();
  const buIds = permissions
    .filter((p) => p.businessUnitId)
    .map((p) => p.businessUnitId!);
  const deptIds = permissions
    .filter((p) => p.departmentId)
    .map((p) => p.departmentId!);

  const now = new Date();

  const scopeConditions: object[] = [{ targetScope: "all" }];
  if (buIds.length > 0) {
    scopeConditions.push({
      targetScope: "businessUnit",
      targetId: { $in: buIds },
    });
  }
  if (deptIds.length > 0) {
    scopeConditions.push({
      targetScope: "department",
      targetId: { $in: deptIds },
    });
  }

  const notifications = await Notification.find({
    isActive: true,
    $and: [
      {
        $or: [
          { expiresAt: { $exists: false } },
          { expiresAt: null },
          { expiresAt: { $gt: now } },
        ],
      },
      { $or: scopeConditions },
    ],
  })
    .sort({ createdAt: -1 })
    .populate("createdBy", "firstName lastName")
    .populate("relatedAppId", "name iconUrl")
    .lean();

  // Determine which are already read by this user
  const notificationIds = notifications.map((n) => n._id);
  const readRecords = await NotificationRead.find({
    userId,
    notificationId: { $in: notificationIds },
  }).lean();

  const readSet = new Set(readRecords.map((r) => r.notificationId.toString()));

  return notifications.map((n) => ({
    ...n,
    isRead: readSet.has((n._id as Types.ObjectId).toString()),
  })) as NotificationLean[];
};

export const getUnreadCount = async (userId: string): Promise<number> => {
  const all = await getNotificationsForUser(userId);
  return all.filter((n) => !n.isRead).length;
};

export const markAsRead = async (
  userId: string,
  notificationId: string,
): Promise<void> => {
  const userObjectId = new Types.ObjectId(userId);
  const notificationObjectId = new Types.ObjectId(notificationId);

  await NotificationRead.findOneAndUpdate(
    { userId: userObjectId, notificationId: notificationObjectId },
    {
      userId: userObjectId,
      notificationId: notificationObjectId,
      readAt: new Date(),
    },
    { upsert: true },
  );
};

export const markAllAsRead = async (userId: string): Promise<void> => {
  const userObjectId = new Types.ObjectId(userId);
  const all = await getNotificationsForUser(userId);
  const unreadIds = all
    .filter((n) => !n.isRead)
    .map((n) => (n._id as Types.ObjectId).toString());

  if (unreadIds.length === 0) return;

  await NotificationRead.bulkWrite(
    unreadIds.map((id) => {
      const notificationObjectId = new Types.ObjectId(id);
      return {
        updateOne: {
          filter: {
            userId: userObjectId,
            notificationId: notificationObjectId,
          },
          update: {
            $setOnInsert: {
              userId: userObjectId,
              notificationId: notificationObjectId,
              readAt: new Date(),
            },
          },
          upsert: true,
        },
      };
    }),
  );
};

export const getAllNotifications = async (): Promise<Record<string, any>[]> => {
  return Notification.find()
    .sort({ createdAt: -1 })
    .populate("createdBy", "firstName lastName")
    .populate("relatedAppId", "name iconUrl")
    .lean() as unknown as Record<string, any>[];
};

export const updateNotification = async (
  id: string,
  data: Partial<CreateNotificationDto>,
): Promise<Record<string, any> | null> => {
  return Notification.findByIdAndUpdate(id, data, {
    new: true,
  }).lean() as unknown as Record<string, any> | null;
};

export const deactivateNotification = async (
  id: string,
): Promise<Record<string, any> | null> => {
  return Notification.findByIdAndUpdate(
    id,
    { isActive: false },
    { new: true },
  ).lean() as unknown as Record<string, any> | null;
};
