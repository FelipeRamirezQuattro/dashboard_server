import { Request, Response } from "express";
import * as categoryService from "../services/workflowBrainCategory.service";
import * as analysisService from "../services/workflowBrainAnalysis.service";
import { getCategoryState } from "../services/workflowBrainState.service";

const userId = (req: Request) => req.user!._id.toString();

const handleError = (res: Response, error: unknown, fallback: string) => {
  const statusCode =
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof error.statusCode === "number"
      ? error.statusCode
      : 500;
  res.status(statusCode).json({
    error: error instanceof Error ? error.message : fallback,
  });
};

export const getCategories = async (_req: Request, res: Response) => {
  try {
    res.json(await categoryService.getCategories());
  } catch (error) {
    handleError(res, error, "Failed to fetch workflow brain categories");
  }
};

export const createCategory = async (req: Request, res: Response) => {
  try {
    if (!req.body.name?.trim()) {
      res.status(400).json({ error: "Category name is required" });
      return;
    }
    const category = await categoryService.createCategory(req.body, userId(req));
    res.status(201).json(category);
  } catch (error) {
    handleError(res, error, "Failed to create workflow brain category");
  }
};

export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const category = await categoryService.getCategoryById(req.params.categoryId);
    if (!category) {
      res.status(404).json({ error: "Workflow brain category not found" });
      return;
    }
    res.json(category);
  } catch (error) {
    handleError(res, error, "Failed to fetch workflow brain category");
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const category = await categoryService.updateCategory(
      req.params.categoryId,
      req.body,
      userId(req),
    );
    if (!category) {
      res.status(404).json({ error: "Workflow brain category not found" });
      return;
    }
    res.json(category);
  } catch (error) {
    handleError(res, error, "Failed to update workflow brain category");
  }
};

export const deleteCategory = async (req: Request, res: Response) => {
  try {
    const category = await categoryService.deleteCategory(
      req.params.categoryId,
      userId(req),
    );
    if (!category) {
      res.status(404).json({ error: "Workflow brain category not found" });
      return;
    }
    res.json({ message: "Workflow brain category deactivated" });
  } catch (error) {
    handleError(res, error, "Failed to delete workflow brain category");
  }
};

export const getState = async (req: Request, res: Response) => {
  try {
    const state = await getCategoryState(req.params.categoryId);
    if (!state) {
      res.status(404).json({ error: "Workflow brain category not found" });
      return;
    }
    res.json(state);
  } catch (error) {
    handleError(res, error, "Failed to fetch workflow brain state");
  }
};

export const createMemory = async (req: Request, res: Response) => {
  try {
    if (!req.body.content?.trim()) {
      res.status(400).json({ error: "Memory content is required" });
      return;
    }
    const memory = await analysisService.createMemoryFact(
      req.params.categoryId,
      req.body.content,
      userId(req),
    );
    res.status(201).json(memory);
  } catch (error) {
    handleError(res, error, "Failed to create memory");
  }
};

export const updateMemory = async (req: Request, res: Response) => {
  try {
    const memory = await analysisService.updateMemory(
      req.params.memoryId,
      req.body,
      userId(req),
    );
    if (!memory) {
      res.status(404).json({ error: "Memory not found" });
      return;
    }
    res.json(memory);
  } catch (error) {
    handleError(res, error, "Failed to update memory");
  }
};

export const deleteMemory = async (req: Request, res: Response) => {
  try {
    const memory = await analysisService.deleteMemory(req.params.memoryId);
    if (!memory) {
      res.status(404).json({ error: "Memory not found" });
      return;
    }
    res.json({ message: "Memory deleted" });
  } catch (error) {
    handleError(res, error, "Failed to delete memory");
  }
};

export const analyzeNote = async (req: Request, res: Response) => {
  try {
    if (!req.body.note?.trim()) {
      res.status(400).json({ error: "Workflow note is required" });
      return;
    }
    const state = await analysisService.analyzeWorkflowNote(
      req.params.categoryId,
      req.body.note,
      userId(req),
    );
    res.status(201).json(state);
  } catch (error) {
    handleError(res, error, "Failed to analyze workflow note");
  }
};

export const createDesign = async (req: Request, res: Response) => {
  try {
    if (!req.body.request?.trim()) {
      res.status(400).json({ error: "Design/process request is required" });
      return;
    }
    const result = await analysisService.createDesignOutput(
      req.params.categoryId,
      req.body.request,
      userId(req),
    );
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error, "Failed to create design output");
  }
};

export const getDesigns = async (req: Request, res: Response) => {
  try {
    res.json(await analysisService.getDesignOutputs(req.params.categoryId));
  } catch (error) {
    handleError(res, error, "Failed to fetch design outputs");
  }
};

export const getDesignById = async (req: Request, res: Response) => {
  try {
    const design = await analysisService.getDesignOutputById(req.params.designId);
    if (!design) {
      res.status(404).json({ error: "Design output not found" });
      return;
    }
    res.json(design);
  } catch (error) {
    handleError(res, error, "Failed to fetch design output");
  }
};

export const updateWorkflowStep = async (req: Request, res: Response) => {
  try {
    const step = await analysisService.updateWorkflowStep(req.params.stepId, req.body);
    if (!step) {
      res.status(404).json({ error: "Workflow step not found" });
      return;
    }
    res.json(step);
  } catch (error) {
    handleError(res, error, "Failed to update workflow step");
  }
};

export const createWorkflowStep = async (req: Request, res: Response) => {
  try {
    if (!req.body.name?.trim()) {
      res.status(400).json({ error: "Workflow step name is required" });
      return;
    }
    const step = await analysisService.createWorkflowStep(
      req.params.categoryId,
      req.body,
    );
    res.status(201).json(step);
  } catch (error) {
    handleError(res, error, "Failed to create workflow step");
  }
};

export const resolveBottleneck = async (req: Request, res: Response) => {
  try {
    const bottleneck = await analysisService.resolveBottleneck(
      req.params.categoryId,
      req.params.bottleneckId,
    );
    if (!bottleneck) {
      res.status(404).json({ error: "Bottleneck not found" });
      return;
    }
    res.json(bottleneck);
  } catch (error) {
    handleError(res, error, "Failed to resolve bottleneck");
  }
};
