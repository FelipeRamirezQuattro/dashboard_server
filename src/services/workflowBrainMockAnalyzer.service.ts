import { z } from "zod";
import { WorkflowBrainState } from "./workflowBrainState.service";

const severityValues = ["low", "medium", "high"] as const;

const entitySchema = z.union([
  z.object({
    name: z.string().min(1),
    type: z.enum([
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
    ]),
    description: z.string().default(""),
  }),
  z.string().min(1).transform((name) => ({
    name,
    type: "other" as const,
    description: name,
  })),
]);

const workflowStepSchema = z.union([
  z.object({
    name: z.string().min(1),
    description: z.string().default(""),
    ownerEntityName: z.string().optional(),
    relatedEntityNames: z.array(z.string()).default([]),
    position: z.number().int().nonnegative().default(0),
    status: z.enum(["active", "unclear", "risky", "optimized"]).default("active"),
  }),
  z.string().min(1).transform((name) => ({
    name,
    description: name,
    ownerEntityName: undefined,
    relatedEntityNames: [],
    position: 0,
    status: "active" as const,
  })),
]);

const workflowEdgeSchema = z.union([
  z.object({
    fromStepName: z.string().min(1),
    toStepName: z.string().min(1),
    label: z.string().default(""),
  }),
  z.string().min(1).transform((label) => ({
    fromStepName: "",
    toStepName: "",
    label,
  })),
]);

const insightSchema = z.union([
  z.object({
    type: z.enum([
      "missing_information",
      "design_dependency",
      "human_dependency",
      "process_risk",
      "document_gap",
      "handoff_risk",
      "qa_risk",
      "operational_risk",
    ]),
    title: z.string().min(1),
    description: z.string().default(""),
    severity: z.enum(severityValues).default("medium"),
    confidence: z.number().min(0).max(1).default(0.75),
    relatedWorkflowStepNames: z.array(z.string()).default([]),
    relatedEntityNames: z.array(z.string()).default([]),
  }),
  z.string().min(1).transform((title) => ({
    type: "operational_risk" as const,
    title,
    description: title,
    severity: "medium" as const,
    confidence: 0.6,
    relatedWorkflowStepNames: [],
    relatedEntityNames: [],
  })),
]);

const unknownAreaSchema = z.union([
  z.object({
    title: z.string().min(1),
    description: z.string().default(""),
    severity: z.enum(severityValues).default("medium"),
    suggestedQuestion: z.string().default(""),
  }),
  z.string().min(1).transform((title) => ({
    title,
    description: title,
    severity: "medium" as const,
    suggestedQuestion: `What should OSI add to this category memory about: ${title}?`,
  })),
]);

export const workflowAnalysisSchema = z.object({
  entities: z
    .array(entitySchema)
    .default([]),
  workflowSteps: z
    .array(workflowStepSchema)
    .default([]),
  workflowEdges: z
    .array(workflowEdgeSchema)
    .default([]),
  insights: z
    .array(insightSchema)
    .default([]),
  unknownAreas: z
    .array(unknownAreaSchema)
    .default([]),
});

export type WorkflowAnalysis = z.infer<typeof workflowAnalysisSchema>;

export const designOutputSchema = z.object({
  title: z.string().min(1),
  answer: z.string().min(1),
  assumptions: z.array(z.string()).default([]),
  requiredInputs: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  recommendedNextSteps: z.array(z.string()).default([]),
  relatedEntities: z.array(z.string()).default([]),
});

export type WorkflowDesignOutput = z.infer<typeof designOutputSchema>;

const includesAny = (value: string, terms: string[]) =>
  terms.some((term) => value.includes(term));

export const analyzeNoteWithMock = (
  note: string,
  _state: WorkflowBrainState,
): WorkflowAnalysis => {
  const lower = note.toLowerCase();
  const separatorContext = includesAny(lower, ["separator", "separation", "gas"]);
  const salesContext = includesAny(lower, ["sales", "proposal", "customer"]);
  const engineeringContext = includesAny(lower, ["engineering", "design"]);
  const qaContext = includesAny(lower, ["qa", "qc", "quality", "inspection"]);
  const missingData = includesAny(lower, [
    "incomplete",
    "missing",
    "unknown",
    "flow rate",
    "pressure",
    "field data",
    "spec",
  ]);

  const entities: WorkflowAnalysis["entities"] = [];
  if (separatorContext) {
    entities.push({
      name: "Separator Request",
      type: "process",
      description: "Customer or internal request for separator review or sizing support.",
    });
  }
  if (salesContext) {
    entities.push({
      name: "Sales",
      type: "department",
      description: "Commercial intake owner for customer requests and initial information gathering.",
    });
  }
  if (engineeringContext) {
    entities.push({
      name: "Engineering",
      type: "department",
      description: "Technical review owner for design feasibility and equipment guidance.",
    });
  }
  if (qaContext) {
    entities.push({
      name: "QA/QC",
      type: "department",
      description: "Quality checkpoint owner for inspection and review gates.",
    });
  }

  const workflowSteps: WorkflowAnalysis["workflowSteps"] = [];
  if (salesContext) {
    workflowSteps.push({
      name: separatorContext ? "Sales receives separator request" : "Sales receives customer request",
      description: "Sales captures the initial customer need and available field or proposal information.",
      ownerEntityName: "Sales",
      relatedEntityNames: separatorContext ? ["Separator Request"] : [],
      position: 10,
      status: missingData ? "unclear" : "active",
    });
  }
  if (engineeringContext || separatorContext) {
    workflowSteps.push({
      name: "Engineering reviews request",
      description: "Engineering evaluates whether the available inputs are sufficient for technical review.",
      ownerEntityName: "Engineering",
      relatedEntityNames: separatorContext ? ["Separator Request"] : [],
      position: 20,
      status: missingData ? "risky" : "active",
    });
  }
  if (qaContext) {
    workflowSteps.push({
      name: "QA/QC review checkpoint",
      description: "Quality review confirms documented requirements, inspection gates, and acceptance criteria.",
      ownerEntityName: "QA/QC",
      relatedEntityNames: [],
      position: 30,
      status: "active",
    });
  }

  const unknownAreas: WorkflowAnalysis["unknownAreas"] = [];
  const insights: WorkflowAnalysis["insights"] = [];

  if (missingData) {
    unknownAreas.push({
      title: "Request completeness owner is unclear",
      description:
        "The category memory has not identified who validates request completeness before engineering review.",
      severity: "medium",
      suggestedQuestion:
        "Who is responsible for confirming required field data before engineering starts review?",
    });
    insights.push({
      type: "handoff_risk",
      title: "Engineering handoff risk",
      description:
        "Incomplete sales-to-engineering handoffs can increase rework and delay preliminary equipment guidance.",
      severity: "high",
      confidence: 0.86,
      relatedWorkflowStepNames: ["Sales receives separator request", "Engineering reviews request"],
      relatedEntityNames: ["Sales", "Engineering"],
    });
  }

  return workflowAnalysisSchema.parse({
    entities,
    workflowSteps,
    workflowEdges:
      workflowSteps.length > 1
        ? [
            {
              fromStepName: workflowSteps[0].name,
              toStepName: workflowSteps[1].name,
              label: "handoff",
            },
          ]
        : [],
    insights,
    unknownAreas,
  });
};

export const createDesignWithMock = (
  request: string,
  state: WorkflowBrainState,
): WorkflowDesignOutput => {
  const categoryName =
    typeof state.category === "object" && state.category && "name" in state.category
      ? String((state.category as { name?: string }).name || "OSI")
      : "OSI";
  const lower = request.toLowerCase();
  const checklist = lower.includes("checklist") || lower.includes("intake");
  const title = checklist
    ? `${categoryName} Intake Checklist`
    : `${categoryName} Process Guidance`;

  return designOutputSchema.parse({
    title,
    answer: [
      `Use this as internal OSI support guidance for ${categoryName}. Engineering review is required before final equipment selection, certified calculations, or released specifications.`,
      "",
      "1. Confirm request owner, customer contact, target use case, and needed response date.",
      "2. Capture operating conditions, constraints, available drawings or prior job references, and known assumptions.",
      "3. Identify missing field data before engineering handoff and assign an owner for each missing item.",
      "4. Route the package through sales or proposals, engineering review, and any QA/QC checkpoint required by the work scope.",
      "5. Document risks, open questions, and the decision made at each review checkpoint.",
    ].join("\n"),
    assumptions: [
      "The output is based only on the selected category memory.",
      "Technical inputs may be incomplete until sales, field service, or engineering confirms them.",
    ],
    requiredInputs: [
      "Flow rate or operating rate basis",
      "Operating pressure and temperature",
      "Fluid or gas composition when relevant",
      "Liquid loading and expected solids or sand content when relevant",
      "Customer constraints, drawings, and applicable standards",
    ],
    risks: [
      "Incomplete field data can delay review or produce incorrect preliminary assumptions.",
      "Final equipment guidance requires qualified engineering review.",
    ],
    recommendedNextSteps: [
      "Assign request completeness ownership before engineering review.",
      "Attach source documents and document assumptions.",
      "Schedule a review checkpoint for unresolved technical questions.",
    ],
    relatedEntities: ["Sales", "Engineering", "QA/QC"],
  });
};
