import { Router } from "express";
import * as businessUnitController from "../controllers/businessUnit.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all business units (admin only)
router.get(
  "/",
  requireRole(["admin", "superadmin"]),
  businessUnitController.getAllBusinessUnits,
);

// Get active business units (all authenticated users)
router.get("/active", businessUnitController.getActiveBusinessUnits);

// Get business unit by ID
router.get("/:id", businessUnitController.getBusinessUnitById);

// Create business unit (admin only)
router.post(
  "/",
  requireRole(["admin", "superadmin"]),
  businessUnitController.createBusinessUnit,
);

// Update business unit (admin only)
router.put(
  "/:id",
  requireRole(["admin", "superadmin"]),
  businessUnitController.updateBusinessUnit,
);

// Delete (deactivate) business unit (superadmin only)
router.delete(
  "/:id",
  requireRole(["superadmin"]),
  businessUnitController.deleteBusinessUnit,
);

export default router;
