import { Router } from "express";
import * as permissionsController from "../controllers/permissions.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get permissions for a specific user
router.get(
  "/user/:userId",
  requireRole(["admin", "superadmin"]),
  permissionsController.getUserPermissions,
);

// Resolve hierarchical permissions for a user
router.get(
  "/user/:userId/resolve",
  permissionsController.resolveUserPermissions,
);

// Create a new permission (admin only)
router.post(
  "/",
  requireRole(["admin", "superadmin"]),
  permissionsController.createUserPermission,
);

// Bulk update user permissions (admin only)
router.put(
  "/user/:userId/bulk",
  requireRole(["admin", "superadmin"]),
  permissionsController.bulkUpdateUserPermissions,
);

// Delete a permission (admin only)
router.delete(
  "/:id",
  requireRole(["admin", "superadmin"]),
  permissionsController.deleteUserPermission,
);

export default router;
