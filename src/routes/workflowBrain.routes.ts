import { Router } from "express";
import * as controller from "../controllers/workflowBrain.controller";
import * as knowledge from "../controllers/brainKnowledge.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { requireCategoryAccess } from "../middleware/categoryAccess.middleware";

const router = Router();

router.use(authenticate);

router.get("/categories", controller.getCategories);
router.post("/categories", requireRole("editor"), controller.createCategory);
router.get("/categories/:categoryId", requireCategoryAccess("categoryId"), controller.getCategoryById);
router.patch(
  "/categories/:categoryId",
  requireRole("editor"),
  requireCategoryAccess("categoryId"),
  controller.updateCategory,
);
router.delete(
  "/categories/:categoryId",
  requireRole("admin"),
  requireCategoryAccess("categoryId"),
  controller.deleteCategory,
);

router.get("/categories/:categoryId/state", requireCategoryAccess("categoryId"), controller.getState);

router.post(
  "/categories/:categoryId/memory",
  requireRole("editor"),
  requireCategoryAccess("categoryId"),
  controller.createMemory,
);
router.patch(
  "/memory/:memoryId",
  requireRole("editor"),
  requireCategoryAccess("memoryId"),
  controller.updateMemory,
);
router.delete(
  "/memory/:memoryId",
  requireRole("editor"),
  requireCategoryAccess("memoryId"),
  controller.deleteMemory,
);

router.post(
  "/categories/:categoryId/analyze-note",
  requireRole("editor"),
  requireCategoryAccess("categoryId"),
  controller.analyzeNote,
);

router.post(
  "/categories/:categoryId/design",
  requireRole("editor"),
  requireCategoryAccess("categoryId"),
  controller.createDesign,
);
router.get("/categories/:categoryId/designs", requireCategoryAccess("categoryId"), controller.getDesigns);
router.get("/designs/:designId", requireCategoryAccess("designId"), controller.getDesignById);

router.patch(
  "/workflow-steps/:stepId",
  requireRole("editor"),
  requireCategoryAccess("stepId"),
  controller.updateWorkflowStep,
);
router.post(
  "/categories/:categoryId/workflow-steps",
  requireRole("editor"),
  requireCategoryAccess("categoryId"),
  controller.createWorkflowStep,
);

router.post(
  "/categories/:categoryId/documents",
  requireRole("admin"),
  requireCategoryAccess("categoryId"),
  knowledge.uploadDocumentFile,
  knowledge.uploadDocument,
);
router.get(
  "/categories/:categoryId/documents",
  requireRole("admin"),
  requireCategoryAccess("categoryId"),
  knowledge.getDocuments,
);
router.patch(
  "/documents/:documentId",
  requireRole("admin"),
  requireCategoryAccess("documentId"),
  knowledge.patchDocument,
);


router.get("/dataset-definitions", requireRole("admin"), knowledge.getDatasetDefinitions);
router.put(
  "/categories/:categoryId/dataset-definitions/:key",
  requireRole("admin"),
  requireCategoryAccess("categoryId"),
  knowledge.putDatasetDefinition,
);
router.post(
  "/categories/:categoryId/datasets/:key/imports",
  requireRole("admin"),
  requireCategoryAccess("categoryId"),
  knowledge.requireDryRun,
  knowledge.uploadImportFiles,
  knowledge.dryRunDatasetImport,
);
router.post(
  "/imports/:importId/commit",
  requireRole("admin"),
  requireCategoryAccess("importId"),
  knowledge.commitDatasetImport,
);
router.post(
  "/imports/:importId/rollback",
  requireRole("admin"),
  requireCategoryAccess("importId"),
  knowledge.rollbackDatasetImport,
);
router.get(
  "/categories/:categoryId/datasets/:key/tables/:table/records",
  requireRole("admin"),
  requireCategoryAccess("categoryId"),
  knowledge.getDatasetRecords,
);
router.get(
  "/categories/:categoryId/datasets/:key/template.zip",
  requireRole("admin"),
  requireCategoryAccess("categoryId"),
  knowledge.getDatasetTemplate,
);

export default router;
