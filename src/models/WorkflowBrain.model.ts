import mongoose, { Document, Schema } from "mongoose";

export type WorkflowBrainDomain =
  | "gas_separation"
  | "chemical_treatment"
  | "sand_filtration"
  | "sales_engineering"
  | "proposals"
  | "field_service"
  | "manufacturing"
  | "qa_qc"
  | "customer_support"
  | "general";

export type BrainMemoryType =
  | "memory_fact"
  | "analyzed_note"
  | "design_request"
  | "system_event";

export type BrainMemorySource = "memory" | "workflow" | "design" | "system";
export type BrainSeverity = "low" | "medium" | "high";

const objectId = Schema.Types.ObjectId;

export interface IWorkflowBrainCategory extends Document {
  name: string;
  description: string;
  domain: WorkflowBrainDomain;
  isActive: boolean;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new Schema<IWorkflowBrainCategory>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", trim: true, maxlength: 1000 },
    domain: {
      type: String,
      enum: [
        "gas_separation",
        "chemical_treatment",
        "sand_filtration",
        "sales_engineering",
        "proposals",
        "field_service",
        "manufacturing",
        "qa_qc",
        "customer_support",
        "general",
      ],
      default: "general",
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    createdBy: { type: objectId, ref: "User", required: true },
    updatedBy: { type: objectId, ref: "User" },
  },
  { timestamps: true },
);

categorySchema.index({ name: 1 }, { unique: true });

export interface IBrainMemory extends Document {
  categoryId: mongoose.Types.ObjectId;
  content: string;
  summary: string;
  type: BrainMemoryType;
  source: BrainMemorySource;
  confidence: number;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const memorySchema = new Schema<IBrainMemory>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true, index: true },
    content: { type: String, required: true, trim: true, maxlength: 12000 },
    summary: { type: String, default: "", trim: true, maxlength: 1200 },
    type: {
      type: String,
      enum: ["memory_fact", "analyzed_note", "design_request", "system_event"],
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ["memory", "workflow", "design", "system"],
      required: true,
      index: true,
    },
    confidence: { type: Number, default: 1, min: 0, max: 1 },
    createdBy: { type: objectId, ref: "User", required: true },
    updatedBy: { type: objectId, ref: "User" },
  },
  { timestamps: true },
);

memorySchema.index({ categoryId: 1, createdAt: -1 });

export interface IBrainEntity extends Document {
  categoryId: mongoose.Types.ObjectId;
  name: string;
  type: string;
  description: string;
  sourceMemoryIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const entitySchema = new Schema<IBrainEntity>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    type: {
      type: String,
      enum: [
        "equipment",
        "component",
        "process",
        "role",
        "department",
        "customer",
        "well",
        "specification",
        "document",
        "tool",
        "risk",
        "material",
        "measurement",
        "other",
      ],
      default: "other",
    },
    description: { type: String, default: "", trim: true, maxlength: 1500 },
    sourceMemoryIds: [{ type: objectId, ref: "BrainMemory" }],
  },
  { timestamps: true },
);

entitySchema.index({ categoryId: 1, name: 1, type: 1 }, { unique: true });

export interface IBrainWorkflowStep extends Document {
  categoryId: mongoose.Types.ObjectId;
  name: string;
  description: string;
  ownerEntityId?: mongoose.Types.ObjectId;
  relatedEntityIds: mongoose.Types.ObjectId[];
  position: number;
  status: "active" | "unclear" | "risky" | "optimized";
  sourceMemoryIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const workflowStepSchema = new Schema<IBrainWorkflowStep>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    ownerEntityId: { type: objectId, ref: "BrainEntity" },
    relatedEntityIds: [{ type: objectId, ref: "BrainEntity" }],
    position: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["active", "unclear", "risky", "optimized"],
      default: "active",
      index: true,
    },
    sourceMemoryIds: [{ type: objectId, ref: "BrainMemory" }],
  },
  { timestamps: true },
);

workflowStepSchema.index({ categoryId: 1, name: 1 }, { unique: true });
workflowStepSchema.index({ categoryId: 1, position: 1 });

export interface IBrainWorkflowEdge extends Document {
  categoryId: mongoose.Types.ObjectId;
  fromStepId: mongoose.Types.ObjectId;
  toStepId: mongoose.Types.ObjectId;
  label: string;
  createdAt: Date;
  updatedAt: Date;
}

const workflowEdgeSchema = new Schema<IBrainWorkflowEdge>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true, index: true },
    fromStepId: { type: objectId, ref: "BrainWorkflowStep", required: true },
    toStepId: { type: objectId, ref: "BrainWorkflowStep", required: true },
    label: { type: String, default: "", trim: true, maxlength: 160 },
  },
  { timestamps: true },
);

workflowEdgeSchema.index(
  { categoryId: 1, fromStepId: 1, toStepId: 1 },
  { unique: true },
);

export interface IBrainBottleneck extends Document {
  categoryId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  severity: BrainSeverity;
  category: string;
  relatedStepIds: mongoose.Types.ObjectId[];
  sourceMemoryIds: mongoose.Types.ObjectId[];
  status: "open" | "improved" | "resolved";
  createdAt: Date;
  updatedAt: Date;
}

const bottleneckSchema = new Schema<IBrainBottleneck>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    severity: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    category: {
      type: String,
      enum: [
        "missing_specification",
        "unclear_owner",
        "approval_delay",
        "engineering_handoff",
        "manual_reentry",
        "qa_gap",
        "document_gap",
        "field_data_gap",
        "design_risk",
        "communication_gap",
        "other",
      ],
      default: "other",
      index: true,
    },
    relatedStepIds: [{ type: objectId, ref: "BrainWorkflowStep" }],
    sourceMemoryIds: [{ type: objectId, ref: "BrainMemory" }],
    status: { type: String, enum: ["open", "improved", "resolved"], default: "open", index: true },
  },
  { timestamps: true },
);

bottleneckSchema.index({ categoryId: 1, title: 1 }, { unique: true });

export interface IBrainRecommendation extends Document {
  categoryId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  recommendationType: string;
  estimatedImpact: BrainSeverity;
  difficulty: "easy" | "medium" | "hard";
  requiredInputs: string[];
  implementationNotes: string;
  relatedBottleneckIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const recommendationSchema = new Schema<IBrainRecommendation>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, default: "", trim: true, maxlength: 2500 },
    recommendationType: {
      type: String,
      enum: ["operational", "design", "process", "documentation", "review", "hybrid"],
      default: "process",
    },
    estimatedImpact: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
    requiredInputs: [{ type: String, trim: true, maxlength: 240 }],
    implementationNotes: { type: String, default: "", trim: true, maxlength: 2500 },
    relatedBottleneckIds: [{ type: objectId, ref: "BrainBottleneck" }],
  },
  { timestamps: true },
);

recommendationSchema.index({ categoryId: 1, title: 1 }, { unique: true });

export interface IBrainInsight extends Document {
  categoryId: mongoose.Types.ObjectId;
  type: string;
  title: string;
  description: string;
  severity: BrainSeverity;
  confidence: number;
  relatedWorkflowStepIds: mongoose.Types.ObjectId[];
  relatedEntityIds: mongoose.Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const insightSchema = new Schema<IBrainInsight>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true, index: true },
    type: {
      type: String,
      enum: [
        "missing_information",
        "design_dependency",
        "human_dependency",
        "process_risk",
        "document_gap",
        "handoff_risk",
        "qa_risk",
        "operational_risk",
      ],
      default: "process_risk",
    },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    severity: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    confidence: { type: Number, default: 0.75, min: 0, max: 1 },
    relatedWorkflowStepIds: [{ type: objectId, ref: "BrainWorkflowStep" }],
    relatedEntityIds: [{ type: objectId, ref: "BrainEntity" }],
  },
  { timestamps: true },
);

insightSchema.index({ categoryId: 1, title: 1 }, { unique: true });

export interface IBrainUnknownArea extends Document {
  categoryId: mongoose.Types.ObjectId;
  title: string;
  description: string;
  severity: BrainSeverity;
  suggestedQuestion: string;
  status: "open" | "answered";
  createdAt: Date;
  updatedAt: Date;
}

const unknownAreaSchema = new Schema<IBrainUnknownArea>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 180 },
    description: { type: String, default: "", trim: true, maxlength: 2000 },
    severity: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    suggestedQuestion: { type: String, default: "", trim: true, maxlength: 500 },
    status: { type: String, enum: ["open", "answered"], default: "open", index: true },
  },
  { timestamps: true },
);

unknownAreaSchema.index({ categoryId: 1, title: 1 }, { unique: true });

export interface IBrainDesignOutput extends Document {
  categoryId: mongoose.Types.ObjectId;
  requestMemoryId: mongoose.Types.ObjectId;
  title: string;
  request: string;
  answer: string;
  assumptions: string[];
  requiredInputs: string[];
  risks: string[];
  recommendedNextSteps: string[];
  relatedEntities: string[];
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const designOutputSchema = new Schema<IBrainDesignOutput>(
  {
    categoryId: { type: objectId, ref: "WorkflowBrainCategory", required: true, index: true },
    requestMemoryId: { type: objectId, ref: "BrainMemory", required: true },
    title: { type: String, required: true, trim: true, maxlength: 220 },
    request: { type: String, required: true, trim: true, maxlength: 12000 },
    answer: { type: String, required: true, trim: true, maxlength: 20000 },
    assumptions: [{ type: String, trim: true, maxlength: 500 }],
    requiredInputs: [{ type: String, trim: true, maxlength: 500 }],
    risks: [{ type: String, trim: true, maxlength: 500 }],
    recommendedNextSteps: [{ type: String, trim: true, maxlength: 500 }],
    relatedEntities: [{ type: String, trim: true, maxlength: 160 }],
    createdBy: { type: objectId, ref: "User", required: true },
  },
  { timestamps: true },
);

designOutputSchema.index({ categoryId: 1, createdAt: -1 });

const stripVersion = {
  transform: (_doc: unknown, ret: any) => {
    delete ret.__v;
    return ret;
  },
};

[
  categorySchema,
  memorySchema,
  entitySchema,
  workflowStepSchema,
  workflowEdgeSchema,
  bottleneckSchema,
  recommendationSchema,
  insightSchema,
  unknownAreaSchema,
  designOutputSchema,
].forEach((schema) => schema.set("toJSON", stripVersion));

export const WorkflowBrainCategory = mongoose.model<IWorkflowBrainCategory>(
  "WorkflowBrainCategory",
  categorySchema,
);
export const BrainMemory = mongoose.model<IBrainMemory>("BrainMemory", memorySchema);
export const BrainEntity = mongoose.model<IBrainEntity>("BrainEntity", entitySchema);
export const BrainWorkflowStep = mongoose.model<IBrainWorkflowStep>(
  "BrainWorkflowStep",
  workflowStepSchema,
);
export const BrainWorkflowEdge = mongoose.model<IBrainWorkflowEdge>(
  "BrainWorkflowEdge",
  workflowEdgeSchema,
);
export const BrainBottleneck = mongoose.model<IBrainBottleneck>(
  "BrainBottleneck",
  bottleneckSchema,
);
export const BrainRecommendation = mongoose.model<IBrainRecommendation>(
  "BrainRecommendation",
  recommendationSchema,
);
export const BrainInsight = mongoose.model<IBrainInsight>("BrainInsight", insightSchema);
export const BrainUnknownArea = mongoose.model<IBrainUnknownArea>(
  "BrainUnknownArea",
  unknownAreaSchema,
);
export const BrainDesignOutput = mongoose.model<IBrainDesignOutput>(
  "BrainDesignOutput",
  designOutputSchema,
);
