import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import {
  BrainDesignOutput,
  BrainMemory,
  BrainWorkflowStep,
  WorkflowBrainCategory,
} from "../models/WorkflowBrain.model";
import { BrainDocument, BrainImportBatch } from "../models/BrainKnowledge.model";
import { decideCategoryAccess } from "../services/brain/categoryAccess";
import { recordBrainAudit } from "../services/brainAudit.service";

export type CategoryAccessSource =
  | "categoryId"
  | "memoryId"
  | "designId"
  | "stepId"
  | "documentId"
  | "importId";

type OwnerModel = { findById: (id: string) => { select: (f: string) => { lean: () => Promise<unknown> } } };

const OWNER_MODELS: Record<Exclude<CategoryAccessSource, "categoryId">, OwnerModel> = {
  memoryId: BrainMemory as unknown as OwnerModel,
  designId: BrainDesignOutput as unknown as OwnerModel,
  stepId: BrainWorkflowStep as unknown as OwnerModel,
  documentId: BrainDocument as unknown as OwnerModel,
  importId: BrainImportBatch as unknown as OwnerModel,
};

const resolveCategoryId = async (
  source: CategoryAccessSource,
  id: string,
): Promise<string | null> => {
  if (source === "categoryId") return id;
  const owner = (await OWNER_MODELS[source].findById(id).select("categoryId").lean()) as {
    categoryId?: unknown;
  } | null;
  return owner?.categoryId ? String(owner.categoryId) : null;
};

const notFound = (res: Response) => res.status(404).json({ error: "Not found" });

export const requireCategoryAccess = (source: CategoryAccessSource) => {
  const middleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Authentication required" });
        return;
      }
      const id = req.params[source];
      if (!id || !mongoose.isValidObjectId(id)) {
        notFound(res);
        return;
      }
      const categoryId = await resolveCategoryId(source, id);
      if (!categoryId || !mongoose.isValidObjectId(categoryId)) {
        notFound(res);
        return;
      }
      const category = await WorkflowBrainCategory.findById(categoryId)
        .select("accessRole isActive")
        .lean();
      const decision = decideCategoryAccess(
        req.user.role,
        category as { accessRole: "viewer" | "editor" | "admin"; isActive?: boolean } | null,
      );
      if (decision === "not_found") {
        notFound(res);
        return;
      }
      if (decision === "forbidden") {
        await recordBrainAudit({
          userId: req.user._id.toString(),
          action: "BRAIN_ACCESS_DENIED",
          target: "brain_category",
          metadata: { categoryId },
          ipAddress: req.ip,
          userAgent: req.get("user-agent") || undefined,
        });
        res.status(403).json({ error: "You do not have access to this category." });
        return;
      }
      next();
    } catch {
      // Invalid ids or DB errors must never surface as a 500 with details.
      notFound(res);
    }
  };
  Object.defineProperty(middleware, "name", { value: `requireCategoryAccess(${source})` });
  return middleware;
};
