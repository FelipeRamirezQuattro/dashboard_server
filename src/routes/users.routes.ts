import { Router } from "express";
import * as usersController from "../controllers/users.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/role.middleware";
import { auditLog } from "../middleware/audit.middleware";

const router = Router();

// All routes require authentication and admin role
router.use(authenticate);
router.use(requireAdmin);

// Get all users
router.get("/", usersController.getUsers);

// Get specific user
router.get("/:id", usersController.getUser);

// Create user
router.post("/", auditLog("USER_CREATE"), usersController.createUser);

// Update user
router.put("/:id", auditLog("USER_UPDATE"), usersController.updateUser);

// Delete user
router.delete("/:id", auditLog("USER_DELETE"), usersController.deleteUser);

export default router;
