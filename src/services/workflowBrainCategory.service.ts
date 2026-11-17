import mongoose from "mongoose";
import { z } from "zod";
import {
  BrainMemory,
  WorkflowBrainCategory,
  WorkflowBrainDomain,
} from "../models/WorkflowBrain.model";

const seedCategories: Array<{
  name: string;
  description: string;
  domain: WorkflowBrainDomain;
}> = [
  {
    name: "Gas Separation",
    description: "Operational memory for separator requests, design inputs, and engineering handoffs.",
    domain: "gas_separation",
  },
  {
    name: "Chemical Treatment",
    description: "Process memory for chemical treatment proposals, review steps, and required data.",
    domain: "chemical_treatment",
  },
  {
    name: "Sand / Filtration Control",
    description: "Category memory for sand control and filtration request handling.",
    domain: "sand_filtration",
  },
  {
    name: "Sales Engineering",
    description: "Sales-to-engineering process memory for technical commercial support.",
    domain: "sales_engineering",
  },
  {
    name: "QA/QC",
    description: "Quality review memory for checkpoints, inspection gates, and documentation gaps.",
    domain: "qa_qc",
  },
];

const seedGasMemory = [
  "Separator requests require flow rate, operating pressure, temperature, gas composition, liquid loading, and expected sand content.",
  "Sales often receives customer requests before all field data is complete.",
  "Engineering reviews separator requests after sales gathers initial information.",
  "Final equipment guidance requires engineering review.",
];

export const ensureSeedCategories = async (userId?: string): Promise<void> => {
  const count = await WorkflowBrainCategory.countDocuments({});
  if (count > 0) return;

  const createdBy = mongoose.Types.ObjectId.isValid(userId || "")
    ? new mongoose.Types.ObjectId(userId)
    : new mongoose.Types.ObjectId();

  const categories = await WorkflowBrainCategory.insertMany(
    seedCategories.map((category) => ({
      ...category,
      createdBy,
      updatedBy: createdBy,
    })),
    { ordered: true },
  );

  const gasCategory = categories.find((category) => category.domain === "gas_separation");
  if (!gasCategory) return;

  await BrainMemory.insertMany([
    ...seedGasMemory.map((content) => ({
      categoryId: gasCategory._id,
      content,
      summary: content,
      type: "memory_fact",
      source: "memory",
      confidence: 1,
      createdBy,
      updatedBy: createdBy,
    })),
    {
      categoryId: gasCategory._id,
      content:
        "When sales receives a new separator request, they sometimes forward incomplete field data to engineering, causing follow-up emails and delays.",
      summary: "Incomplete separator request data creates engineering follow-up and delay.",
      type: "analyzed_note",
      source: "workflow",
      confidence: 0.9,
      createdBy,
      updatedBy: createdBy,
    },
  ]);
};

export const getCategories = async () => {
  await ensureSeedCategories();
  return WorkflowBrainCategory.find({ isActive: true }).sort({ name: 1 });
};

export const getCategoryById = async (categoryId: string) => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) return null;
  return WorkflowBrainCategory.findOne({ _id: categoryId, isActive: true });
};

const categorySettingsSchema = z
  .object({
    accessRole: z.enum(["viewer", "editor", "admin"]),
    groundingMode: z.enum(["strict", "standard"]),
    minEvidenceCount: z.number().int().min(1).max(10),
  })
  .partial()
  .strict();

type CategorySettings = z.infer<typeof categorySettingsSchema>;

const parseSettings = (input: Record<string, unknown>): CategorySettings => {
  const picked: Record<string, unknown> = {};
  for (const key of ["accessRole", "groundingMode", "minEvidenceCount"]) {
    if (input[key] !== undefined) picked[key] = input[key];
  }
  const result = categorySettingsSchema.safeParse(picked);
  if (!result.success) {
    // statusCode 400 is mapped by handleError in workflowBrain.controller.ts
    throw Object.assign(
      new Error(`Invalid category settings: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`),
      { statusCode: 400 },
    );
  }
  return result.data;
};

export const createCategory = async (
  data: {
    name: string;
    description?: string;
    domain?: WorkflowBrainDomain;
    accessRole?: string;
    groundingMode?: string;
    minEvidenceCount?: number;
  },
  userId: string,
) => {
  const settings = parseSettings(data);
  return WorkflowBrainCategory.create({
    name: data.name,
    description: data.description || "",
    domain: data.domain || "general",
    ...settings,
    groundingMode: settings.groundingMode ?? "strict",
    createdBy: userId,
    updatedBy: userId,
  });
};

export const updateCategory = async (
  categoryId: string,
  data: Partial<{
    name: string;
    description: string;
    domain: WorkflowBrainDomain;
    isActive: boolean;
    accessRole: string;
    groundingMode: string;
    minEvidenceCount: number;
  }>,
  userId: string,
) => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) return null;
  const settings = parseSettings(data);
  return WorkflowBrainCategory.findByIdAndUpdate(
    categoryId,
    { ...data, ...settings, updatedBy: userId },
    { new: true, runValidators: true },
  );
};

export const deleteCategory = async (categoryId: string, userId: string) => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) return null;
  return WorkflowBrainCategory.findByIdAndUpdate(
    categoryId,
    { isActive: false, updatedBy: userId },
    { new: true },
  );
};
