import { Router } from "express";
import * as controller from "../controllers/workflowBrain.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

router.use(authenticate);

router.get("/categories", controller.getCategories);
router.post("/categories", requireRole("editor"), controller.createCategory);
router.get("/categories/:categoryId", controller.getCategoryById);
router.patch("/categories/:categoryId", requireRole("editor"), controller.updateCategory);
router.delete("/categories/:categoryId", requireRole("admin"), controller.deleteCategory);

router.get("/categories/:categoryId/state", controller.getState);

router.post("/categories/:categoryId/memory", requireRole("editor"), controller.createMemory);
router.patch("/memory/:memoryId", requireRole("editor"), controller.updateMemory);
router.delete("/memory/:memoryId", requireRole("editor"), controller.deleteMemory);

router.post(
  "/categories/:categoryId/analyze-note",
  requireRole("editor"),
  controller.analyzeNote,
);

router.post("/categories/:categoryId/design", requireRole("editor"), controller.createDesign);
router.get("/categories/:categoryId/designs", controller.getDesigns);
router.get("/designs/:designId", controller.getDesignById);

router.patch("/workflow-steps/:stepId", requireRole("editor"), controller.updateWorkflowStep);
router.post(
  "/categories/:categoryId/workflow-steps",
  requireRole("editor"),
  controller.createWorkflowStep,
);

export default router;
