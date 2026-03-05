import { Router } from "express";
import * as adminController from "../controllers/admin.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/role.middleware";
import { auditLog } from "../middleware/audit.middleware";

const router = Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// App Management
router.get("/apps", adminController.getAllApps);
router.post("/apps", auditLog("APP_CREATE"), adminController.createApp);
router.put("/apps/:id", auditLog("APP_UPDATE"), adminController.updateApp);
router.delete("/apps/:id", auditLog("APP_DELETE"), adminController.deleteApp);

// Audit Logs
router.get("/audit", adminController.getAuditLogs);

export default router;
