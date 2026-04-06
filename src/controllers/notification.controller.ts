import { Request, Response } from "express";
import * as notificationService from "../services/notification.service";
import * as notificationSSE from "../services/notificationSSE.service";
import { generateSseToken, verifySseToken } from "../utils/sseToken.utils";
import logger from "../utils/logger";

export const getNotifications = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const notifications = await notificationService.getNotificationsForUser(
      req.user._id.toString(),
    );
    res.json({ notifications });
  } catch (error) {
    logger.error("Get notifications error:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
};

export const getUnreadCount = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const count = await notificationService.getUnreadCount(
      req.user._id.toString(),
    );
    res.json({ count });
  } catch (error) {
    logger.error("Get unread count error:", error);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
};

export const requestSseToken = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const token = generateSseToken(req.user._id.toString());
    res.json({ token });
  } catch (error) {
    logger.error("SSE token request error:", error);
    res.status(500).json({ error: "Failed to generate SSE token" });
  }
};

// SSE stream endpoint — authenticates via short-lived token in query param
// (EventSource browser API does not support custom headers)
export const sseStream = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== "string") {
      res.status(401).json({ error: "SSE token required" });
      return;
    }
    const userId = verifySseToken(token);
    notificationSSE.registerClient(userId, res);
  } catch (error) {
    logger.error("SSE stream auth error:", error);
    res.status(401).json({ error: "Invalid SSE token" });
  }
};

export const getAllNotificationsAdmin = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const notifications = await notificationService.getAllNotifications();
    res.json({ notifications });
  } catch (error) {
    logger.error("Get all notifications (admin) error:", error);
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
};

export const createNotification = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const notification = await notificationService.createNotification(
      req.body,
      req.user._id.toString(),
    );
    res.status(201).json({ notification });
  } catch (error) {
    logger.error("Create notification error:", error);
    res.status(500).json({ error: "Failed to create notification" });
  }
};

export const updateNotification = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const notification = await notificationService.updateNotification(
      id,
      req.body,
    );
    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ notification });
  } catch (error) {
    logger.error("Update notification error:", error);
    res.status(500).json({ error: "Failed to update notification" });
  }
};

export const deleteNotification = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const notification = await notificationService.deactivateNotification(id);
    if (!notification) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json({ message: "Notification deactivated" });
  } catch (error) {
    logger.error("Delete notification error:", error);
    res.status(500).json({ error: "Failed to delete notification" });
  }
};

export const markRead = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    await notificationService.markAsRead(req.user._id.toString(), id);
    res.json({ success: true });
  } catch (error) {
    logger.error("Mark read error:", error);
    res.status(500).json({ error: "Failed to mark notification as read" });
  }
};

export const markAllRead = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    await notificationService.markAllAsRead(req.user._id.toString());
    res.json({ success: true });
  } catch (error) {
    logger.error("Mark all read error:", error);
    res.status(500).json({ error: "Failed to mark all notifications as read" });
  }
};

export const getConnectedClients = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  res.json({ connectedClients: notificationSSE.getConnectedClientCount() });
};
