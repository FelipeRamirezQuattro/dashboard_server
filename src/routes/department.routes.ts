import { Router } from "express";
import * as departmentController from "../controllers/department.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all departments (admin only)
router.get(
  "/",
  requireRole(["admin", "superadmin"]),
  departmentController.getAllDepartments,
);

// Get active departments (all authenticated users)
router.get("/active", departmentController.getActiveDepartments);

// Get departments by business unit
router.get(
  "/by-business-unit/:buId",
  departmentController.getDepartmentsByBusinessUnit,
);

// Get department by ID
router.get("/:id", departmentController.getDepartmentById);

// Create department (admin only)
router.post(
  "/",
  requireRole(["admin", "superadmin"]),
  departmentController.createDepartment,
);

// Update department (admin only)
router.put(
  "/:id",
  requireRole(["admin", "superadmin"]),
  departmentController.updateDepartment,
);

// Delete (deactivate) department (superadmin only)
router.delete(
  "/:id",
  requireRole(["superadmin"]),
  departmentController.deleteDepartment,
);

export default router;
