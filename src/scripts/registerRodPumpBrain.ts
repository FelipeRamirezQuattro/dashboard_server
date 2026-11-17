/// <reference types="node" />
import mongoose from "mongoose";
import { env } from "../config/env";
import User from "../models/User.model";
import { WorkflowBrainCategory } from "../models/WorkflowBrain.model";
import { registerDefinition } from "../services/brain/datasets.service";
import { rodPumpFailureDefinition } from "../services/brain/definitions/rodPumpFailure";
import type { DatasetDefinition } from "../services/brain/types";

export const ROD_PUMP_CATEGORY_NAME = "Rod Pump Failure";

export const ROD_PUMP_CATEGORY_SETTINGS = {
  domain: "field_service",
  description: "Grounded rod pump failure analysis: failure modes, run life, and evidence from teardown reports.",
  accessRole: "admin",
  groundingMode: "strict",
  minEvidenceCount: 2,
  isActive: true,
} as const;

export interface ExistingCategory {
  name: string;
  accessRole?: string;
  groundingMode?: string;
  minEvidenceCount?: number;
}

/** Pure: create when absent; otherwise never modify, only report settings that differ from the intended ones. */
export const planBootstrap = (
  existing: ExistingCategory | null,
): { action: "create" | "noop"; drift: string[] } => {
  if (!existing) return { action: "create", drift: [] };
  const drift: string[] = [];
  if (existing.accessRole !== ROD_PUMP_CATEGORY_SETTINGS.accessRole) drift.push("accessRole");
  if (existing.groundingMode !== ROD_PUMP_CATEGORY_SETTINGS.groundingMode) drift.push("groundingMode");
  if (existing.minEvidenceCount !== ROD_PUMP_CATEGORY_SETTINGS.minEvidenceCount) drift.push("minEvidenceCount");
  return { action: "noop", drift };
};

export interface BootstrapPorts {
  findCategory(name: string): Promise<(ExistingCategory & { _id: unknown }) | null>;
  findAdminUserId(): Promise<string | null>;
  createCategory(
    data: typeof ROD_PUMP_CATEGORY_SETTINGS & { name: string; createdBy: string },
  ): Promise<{ _id: unknown }>;
  registerDefinition(categoryId: string, def: DatasetDefinition, userId: string): Promise<void>;
}

export interface BootstrapResult {
  categoryId: string;
  status: "created" | "already present";
  drift: string[];
}

/** Idempotent core. Registering the definition is itself an upsert, so repeat runs change nothing. */
export const runBootstrap = async (ports: BootstrapPorts): Promise<BootstrapResult> => {
  const existing = await ports.findCategory(ROD_PUMP_CATEGORY_NAME);
  const plan = planBootstrap(existing);
  const userId = await ports.findAdminUserId();
  if (!userId) {
    throw new Error("No superadmin or admin user found; create one before running the Rod Pump bootstrap.");
  }
  let categoryId: string;
  if (plan.action === "create") {
    const created = await ports.createCategory({
      name: ROD_PUMP_CATEGORY_NAME,
      ...ROD_PUMP_CATEGORY_SETTINGS,
      createdBy: userId,
    });
    categoryId = String(created._id);
  } else {
    categoryId = String(existing!._id);
  }
  await ports.registerDefinition(categoryId, rodPumpFailureDefinition, userId);
  return { categoryId, status: plan.action === "create" ? "created" : "already present", drift: plan.drift };
};

const mongoPorts = (): BootstrapPorts => ({
  findCategory: async (name) => {
    const doc = await WorkflowBrainCategory.findOne({ name }).lean();
    return doc
      ? {
          _id: doc._id,
          name: doc.name,
          accessRole: doc.accessRole,
          groundingMode: doc.groundingMode,
          minEvidenceCount: doc.minEvidenceCount,
        }
      : null;
  },
  findAdminUserId: async () => {
    const superadmin = await User.findOne({ role: "superadmin" }).sort({ createdAt: 1 }).select("_id").lean();
    const user = superadmin || (await User.findOne({ role: "admin" }).sort({ createdAt: 1 }).select("_id").lean());
    return user ? String(user._id) : null;
  },
  createCategory: async (data) => {
    const doc = await WorkflowBrainCategory.create({ ...data, createdBy: new mongoose.Types.ObjectId(data.createdBy) });
    return { _id: doc._id };
  },
  registerDefinition,
});

const main = async (): Promise<void> => {
  if (!env.mongodbUri) throw new Error("MONGODB_URI is not configured.");
  await mongoose.connect(env.mongodbUri);
  try {
    const result = await runBootstrap(mongoPorts());
    console.log(`Rod Pump Failure category ${result.status} (id=${result.categoryId})`);
    console.log(`Dataset definition "${rodPumpFailureDefinition.key}" registered (id=${result.categoryId})`);
    for (const setting of result.drift) {
      console.log(`DRIFT: ${setting} differs from the intended setting (left unchanged)`);
    }
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch((error) => {
    console.error(`Rod Pump bootstrap failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exit(1);
  });
}
