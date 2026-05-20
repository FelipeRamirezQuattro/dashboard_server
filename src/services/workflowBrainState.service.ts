import mongoose from "mongoose";
import {
  BrainBottleneck,
  BrainDesignOutput,
  BrainEntity,
  BrainInsight,
  BrainMemory,
  BrainRecommendation,
  BrainUnknownArea,
  BrainWorkflowEdge,
  BrainWorkflowStep,
  WorkflowBrainCategory,
} from "../models/WorkflowBrain.model";

export interface WorkflowBrainState {
  category: unknown;
  memories: unknown[];
  entities: unknown[];
  workflowSteps: unknown[];
  workflowEdges: unknown[];
  bottlenecks: unknown[];
  recommendations: unknown[];
  insights: unknown[];
  unknownAreas: unknown[];
  designOutputs: unknown[];
}

export const getCategoryState = async (
  categoryId: string,
): Promise<WorkflowBrainState | null> => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) return null;

  const category = await WorkflowBrainCategory.findOne({
    _id: categoryId,
    isActive: true,
  });
  if (!category) return null;

  const [
    memories,
    entities,
    workflowSteps,
    workflowEdges,
    bottlenecks,
    recommendations,
    insights,
    unknownAreas,
    designOutputs,
  ] = await Promise.all([
    BrainMemory.find({ categoryId }).sort({ createdAt: -1 }).limit(100),
    BrainEntity.find({ categoryId }).sort({ name: 1 }),
    BrainWorkflowStep.find({ categoryId }).sort({ position: 1, createdAt: 1 }),
    BrainWorkflowEdge.find({ categoryId }).sort({ createdAt: 1 }),
    BrainBottleneck.find({ categoryId }).sort({ status: 1, severity: 1, createdAt: -1 }),
    BrainRecommendation.find({ categoryId }).sort({ estimatedImpact: 1, createdAt: -1 }),
    BrainInsight.find({ categoryId }).sort({ severity: 1, createdAt: -1 }),
    BrainUnknownArea.find({ categoryId }).sort({ status: 1, severity: 1, createdAt: -1 }),
    BrainDesignOutput.find({ categoryId }).sort({ createdAt: -1 }).limit(25),
  ]);

  return {
    category,
    memories,
    entities,
    workflowSteps,
    workflowEdges,
    bottlenecks,
    recommendations,
    insights,
    unknownAreas,
    designOutputs,
  };
};

export const requireCategoryState = async (
  categoryId: string,
): Promise<WorkflowBrainState> => {
  const state = await getCategoryState(categoryId);
  if (!state) {
    throw Object.assign(new Error("Workflow brain category not found"), {
      statusCode: 404,
    });
  }
  return state;
};
