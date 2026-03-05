import { Router } from "express";
import * as appsController from "../controllers/apps.controller";
import { authenticate } from "../middleware/auth.middleware";
import { auditLog } from "../middleware/audit.middleware";

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get apps accessible to current user
router.get("/", appsController.getApps);

// Launch app (with SSO if configured)
router.post("/:appId/launch", auditLog("APP_LAUNCH"), appsController.launchApp);

export default router;
