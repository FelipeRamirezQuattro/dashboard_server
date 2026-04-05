import { Router } from "express";
import * as notificationController from "../controllers/notification.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/role.middleware";

const router = Router();

// SSE stream — authenticated via short-lived token in query param (no Bearer header support in EventSource)
router.get("/sse", notificationController.sseStream);

// All other routes require JWT authentication
router.use(authenticate);

// User-scoped endpoints
router.get("/", notificationController.getNotifications);
router.get("/unread-count", notificationController.getUnreadCount);
router.post("/sse-token", notificationController.requestSseToken);
router.patch("/:id/read", notificationController.markRead);
router.patch("/read-all", notificationController.markAllRead);

// Admin-only endpoints
router.get("/admin/all", requireAdmin, notificationController.getAllNotificationsAdmin);
router.post("/", requireAdmin, notificationController.createNotification);
router.put("/:id", requireAdmin, notificationController.updateNotification);
router.delete("/:id", requireAdmin, notificationController.deleteNotification);
router.get("/admin/connected-clients", requireAdmin, notificationController.getConnectedClients);

export default router;
