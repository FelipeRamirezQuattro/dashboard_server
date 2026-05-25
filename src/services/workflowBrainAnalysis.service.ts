import mongoose from "mongoose";
import {
  BrainDesignOutput,
  BrainEntity,
  BrainInsight,
  BrainMemory,
  BrainUnknownArea,
  BrainWorkflowEdge,
  BrainWorkflowStep,
} from "../models/WorkflowBrain.model";
import { createDesignWithMock, analyzeNoteWithMock, WorkflowAnalysis } from "./workflowBrainMockAnalyzer.service";
import { workflowBrainOpenaiService } from "./workflowBrainOpenai.service";
import { requireCategoryState } from "./workflowBrainState.service";

const objectId = (value: string) => new mongoose.Types.ObjectId(value);

const summaryFor = (content: string) =>
  content.length > 220 ? `${content.slice(0, 217).trim()}...` : content;

export const createMemoryFact = async (
  categoryId: string,
  content: string,
  userId: string,
) => {
  await requireCategoryState(categoryId);
  return BrainMemory.create({
    categoryId: objectId(categoryId),
    content,
    summary: summaryFor(content),
    type: "memory_fact",
    source: "memory",
    confidence: 1,
    createdBy: objectId(userId),
    updatedBy: objectId(userId),
  });
};

export const updateMemory = async (
  memoryId: string,
  data: { content?: string; summary?: string },
  userId: string,
) => {
  if (!mongoose.Types.ObjectId.isValid(memoryId)) return null;
  const update: Record<string, unknown> = { updatedBy: objectId(userId) };
  if (data.content) {
    update.content = data.content;
    update.summary = data.summary || summaryFor(data.content);
  } else if (data.summary !== undefined) {
    update.summary = data.summary;
  }
  return BrainMemory.findByIdAndUpdate(memoryId, update, {
    new: true,
    runValidators: true,
  });
};

export const deleteMemory = async (memoryId: string) => {
  if (!mongoose.Types.ObjectId.isValid(memoryId)) return null;
  return BrainMemory.findByIdAndDelete(memoryId);
};

const addSource = (existing: mongoose.Types.ObjectId[], memoryId: mongoose.Types.ObjectId) => {
  const ids = new Set(existing.map((id) => id.toString()));
  ids.add(memoryId.toString());
  return [...ids].map((id) => objectId(id));
};

const upsertAnalysis = async (
  categoryId: string,
  sourceMemoryId: mongoose.Types.ObjectId,
  analysis: WorkflowAnalysis,
) => {
  const categoryObjectId = objectId(categoryId);
  const entityMap = new Map<string, mongoose.Types.ObjectId>();
  const stepMap = new Map<string, mongoose.Types.ObjectId>();

  for (const entity of analysis.entities) {
    const existing = await BrainEntity.findOne({
      categoryId: categoryObjectId,
      name: entity.name,
      type: entity.type,
    });
    const saved =
      existing ||
      (await BrainEntity.create({
        categoryId: categoryObjectId,
        name: entity.name,
        type: entity.type,
        description: entity.description,
        sourceMemoryIds: [sourceMemoryId],
      }));
    if (existing) {
      existing.description = entity.description || existing.description;
      existing.sourceMemoryIds = addSource(existing.sourceMemoryIds, sourceMemoryId);
      await existing.save();
    }
    entityMap.set(entity.name, saved._id);
  }

  for (const step of analysis.workflowSteps) {
    const ownerEntityId = step.ownerEntityName
      ? entityMap.get(step.ownerEntityName)
      : undefined;
    const relatedEntityIds = step.relatedEntityNames
      .map((name) => entityMap.get(name))
      .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
    const existing = await BrainWorkflowStep.findOne({
      categoryId: categoryObjectId,
      name: step.name,
    });
    const saved =
      existing ||
      (await BrainWorkflowStep.create({
        categoryId: categoryObjectId,
        name: step.name,
        description: step.description,
        ownerEntityId,
        relatedEntityIds,
        position: step.position,
        status: step.status,
        sourceMemoryIds: [sourceMemoryId],
      }));
    if (existing) {
      existing.description = step.description || existing.description;
      existing.ownerEntityId = ownerEntityId || existing.ownerEntityId;
      existing.relatedEntityIds = relatedEntityIds.length
        ? relatedEntityIds
        : existing.relatedEntityIds;
      existing.position = step.position || existing.position;
      existing.status = step.status;
      existing.sourceMemoryIds = addSource(existing.sourceMemoryIds, sourceMemoryId);
      await existing.save();
    }
    stepMap.set(step.name, saved._id);
  }

  for (const edge of analysis.workflowEdges) {
    const fromStepId = stepMap.get(edge.fromStepName);
    const toStepId = stepMap.get(edge.toStepName);
    if (!fromStepId || !toStepId) continue;
    await BrainWorkflowEdge.findOneAndUpdate(
      { categoryId: categoryObjectId, fromStepId, toStepId },
      { categoryId: categoryObjectId, fromStepId, toStepId, label: edge.label },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  for (const insight of analysis.insights) {
    const relatedWorkflowStepIds = insight.relatedWorkflowStepNames
      .map((name) => stepMap.get(name))
      .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
    const relatedEntityIds = insight.relatedEntityNames
      .map((name) => entityMap.get(name))
      .filter((id): id is mongoose.Types.ObjectId => Boolean(id));
    await BrainInsight.findOneAndUpdate(
      { categoryId: categoryObjectId, title: insight.title },
      {
        categoryId: categoryObjectId,
        type: insight.type,
        title: insight.title,
        description: insight.description,
        severity: insight.severity,
        confidence: insight.confidence,
        relatedWorkflowStepIds,
        relatedEntityIds,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  for (const unknownArea of analysis.unknownAreas) {
    await BrainUnknownArea.findOneAndUpdate(
      { categoryId: categoryObjectId, title: unknownArea.title },
      {
        categoryId: categoryObjectId,
        title: unknownArea.title,
        description: unknownArea.description,
        severity: unknownArea.severity,
        suggestedQuestion: unknownArea.suggestedQuestion,
        status: "open",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
};

export const analyzeWorkflowNote = async (
  categoryId: string,
  note: string,
  userId: string,
) => {
  const initialState = await requireCategoryState(categoryId);
  const memory = await BrainMemory.create({
    categoryId: objectId(categoryId),
    content: note,
    summary: summaryFor(note),
    type: "analyzed_note",
    source: "workflow",
    confidence: 0.9,
    createdBy: objectId(userId),
    updatedBy: objectId(userId),
  });

  const stateWithNote = await requireCategoryState(categoryId);
  const analysis = workflowBrainOpenaiService.isEnabled()
    ? await workflowBrainOpenaiService.analyzeNote(note, stateWithNote)
    : analyzeNoteWithMock(note, initialState);

  await upsertAnalysis(categoryId, memory._id, analysis);
  return requireCategoryState(categoryId);
};

export const createDesignOutput = async (
  categoryId: string,
  request: string,
  userId: string,
) => {
  await requireCategoryState(categoryId);
  const memory = await BrainMemory.create({
    categoryId: objectId(categoryId),
    content: request,
    summary: summaryFor(request),
    type: "design_request",
    source: "design",
    confidence: 0.9,
    createdBy: objectId(userId),
    updatedBy: objectId(userId),
  });

  const state = await requireCategoryState(categoryId);
  const output = workflowBrainOpenaiService.isEnabled()
    ? await workflowBrainOpenaiService.createDesignOutput(request, state)
    : createDesignWithMock(request, state);

  const designOutput = await BrainDesignOutput.create({
    categoryId: objectId(categoryId),
    requestMemoryId: memory._id,
    title: output.title,
    request,
    answer: output.answer,
    assumptions: output.assumptions,
    requiredInputs: output.requiredInputs,
    risks: output.risks,
    recommendedNextSteps: output.recommendedNextSteps,
    relatedEntities: output.relatedEntities,
    createdBy: objectId(userId),
  });

  for (const requiredInput of output.requiredInputs.slice(0, 6)) {
    await BrainUnknownArea.findOneAndUpdate(
      {
        categoryId: objectId(categoryId),
        title: `Missing input: ${requiredInput}`,
      },
      {
        categoryId: objectId(categoryId),
        title: `Missing input: ${requiredInput}`,
        description: `The design/process output identified this required input: ${requiredInput}.`,
        severity: "medium",
        suggestedQuestion: `Can OSI confirm ${requiredInput} for this request?`,
        status: "open",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  return {
    designOutput,
    state: await requireCategoryState(categoryId),
  };
};

export const getDesignOutputs = async (categoryId: string) => {
  await requireCategoryState(categoryId);
  return BrainDesignOutput.find({ categoryId }).sort({ createdAt: -1 });
};

export const getDesignOutputById = async (designId: string) => {
  if (!mongoose.Types.ObjectId.isValid(designId)) return null;
  return BrainDesignOutput.findById(designId);
};

export const updateWorkflowStep = async (
  stepId: string,
  data: Partial<{ name: string; description: string; position: number; status: string }>,
) => {
  if (!mongoose.Types.ObjectId.isValid(stepId)) return null;
  return BrainWorkflowStep.findByIdAndUpdate(stepId, data, {
    new: true,
    runValidators: true,
  });
};

export const createWorkflowStep = async (
  categoryId: string,
  data: { name: string; description?: string; position?: number; status?: string },
) => {
  await requireCategoryState(categoryId);
  return BrainWorkflowStep.create({
    categoryId: objectId(categoryId),
    name: data.name,
    description: data.description || "",
    position: data.position || 0,
    status: data.status || "active",
    sourceMemoryIds: [],
  });
};
