import mongoose from "mongoose";
import {
  BrainBottleneck,
  BrainMemory,
  BrainRecommendation,
  BrainUnknownArea,
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
  "Final equipment recommendations require engineering review.",
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

  const memoryDocs = await BrainMemory.insertMany([
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

  const sourceMemoryIds = memoryDocs.map((memory) => memory._id);

  await Promise.all([
    BrainBottleneck.create({
      categoryId: gasCategory._id,
      title: "Missing field data delays engineering review",
      description:
        "Sales sometimes routes separator requests before required field data is complete.",
      severity: "high",
      category: "field_data_gap",
      sourceMemoryIds,
      status: "open",
    }),
    BrainRecommendation.create({
      categoryId: gasCategory._id,
      title: "Create a separator request intake checklist before engineering handoff",
      description:
        "Standardize required separator design inputs before engineering review starts.",
      recommendationType: "documentation",
      estimatedImpact: "high",
      difficulty: "easy",
      requiredInputs: [
        "Flow rate",
        "Operating pressure",
        "Temperature",
        "Gas composition",
        "Liquid loading",
        "Expected sand content",
      ],
      implementationNotes:
        "Use the checklist as a request completeness gate and document assumptions before handoff.",
    }),
    BrainUnknownArea.create({
      categoryId: gasCategory._id,
      title: "Request completeness owner is unclear",
      description:
        "The category memory has not identified who validates request completeness before engineering review.",
      severity: "medium",
      suggestedQuestion:
        "Who confirms separator request completeness before engineering starts review?",
      status: "open",
    }),
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

export const createCategory = async (
  data: { name: string; description?: string; domain?: WorkflowBrainDomain },
  userId: string,
) => {
  return WorkflowBrainCategory.create({
    name: data.name,
    description: data.description || "",
    domain: data.domain || "general",
    createdBy: userId,
    updatedBy: userId,
  });
};

export const updateCategory = async (
  categoryId: string,
  data: Partial<{ name: string; description: string; domain: WorkflowBrainDomain; isActive: boolean }>,
  userId: string,
) => {
  if (!mongoose.Types.ObjectId.isValid(categoryId)) return null;
  return WorkflowBrainCategory.findByIdAndUpdate(
    categoryId,
    { ...data, updatedBy: userId },
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
