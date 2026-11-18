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
  accessRole?: string | null;
  groundingMode?: string | null;
  minEvidenceCount?: number | null;
  isActive?: boolean | null;
}

export type BootstrapPlan =
  | { action: "create" | "noop"; drift: string[] }
  | { action: "refuse"; drift: string[]; reason: "inactive_only" | "multiple_active" };

/**
 * Pure. `active` = categories found with { name, isActive: true } (name is not unique). Create only when no category
 * with the name exists at all; an inactive namesake alone is refused (never silently duplicated or reactivated), as
 * are several active namesakes. An existing category is never modified: settings that differ (missing fields count)
 * are reported as drift, and the CLI exits non-zero.
 */
export const planBootstrap = (active: ExistingCategory[], hasInactive: boolean): BootstrapPlan => {
  if (active.length > 1) return { action: "refuse", drift: [], reason: "multiple_active" };
  if (active.length === 0) return hasInactive ? { action: "refuse", drift: [], reason: "inactive_only" } : { action: "create", drift: [] };
  const existing = active[0];
  const drift: string[] = [];
  if (existing.accessRole !== ROD_PUMP_CATEGORY_SETTINGS.accessRole) drift.push("accessRole");
  if (existing.groundingMode !== ROD_PUMP_CATEGORY_SETTINGS.groundingMode) drift.push("groundingMode");
  if (existing.minEvidenceCount !== ROD_PUMP_CATEGORY_SETTINGS.minEvidenceCount) drift.push("minEvidenceCount");
  if (existing.isActive !== ROD_PUMP_CATEGORY_SETTINGS.isActive) drift.push("isActive");
  return { action: "noop", drift };
};

const REFUSE_MESSAGES: Record<"inactive_only" | "multiple_active", string> = {
  inactive_only:
    `An inactive "${ROD_PUMP_CATEGORY_NAME}" category exists and no active one does. Nothing was changed: reactivate or rename it in the Brain UI (admin), then re-run.`,
  multiple_active:
    `More than one active "${ROD_PUMP_CATEGORY_NAME}" category exists. Nothing was changed: rename or deactivate the extra ones in the Brain UI (admin), then re-run.`,
};

export interface BootstrapPorts {
  /** Must query { name, isActive: true }. */
  findActiveCategories(filter: { name: string; isActive: true }): Promise<Array<ExistingCategory & { _id: unknown }>>;
  hasInactiveCategory(name: string): Promise<boolean>;
  findAdminUserId(): Promise<string | null>;
  createCategory(
    data: typeof ROD_PUMP_CATEGORY_SETTINGS & { name: string; createdBy: string },
  ): Promise<{ _id: unknown }>;
  registerDefinition(categoryId: string, def: DatasetDefinition, userId: string): Promise<void>;
}

export interface BootstrapResult {
  categoryId: string;
  /** "drift": the category exists with different settings; nothing was changed or registered (CLI exits 1). */
  status: "created" | "already present" | "drift";
  drift: string[];
}

/** Idempotent core. Registering the definition is itself an upsert, so repeat runs change nothing. */
export const runBootstrap = async (ports: BootstrapPorts): Promise<BootstrapResult> => {
  const active = await ports.findActiveCategories({ name: ROD_PUMP_CATEGORY_NAME, isActive: true });
  const hasInactive = active.length === 0 ? await ports.hasInactiveCategory(ROD_PUMP_CATEGORY_NAME) : false;
  const plan = planBootstrap(active, hasInactive);
  if (plan.action === "refuse") throw new Error(REFUSE_MESSAGES[plan.reason]);
  if (plan.action === "noop" && plan.drift.length > 0) {
    return { categoryId: String(active[0]._id), status: "drift", drift: plan.drift };
  }
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
    categoryId = String(active[0]._id);
  }
  await ports.registerDefinition(categoryId, rodPumpFailureDefinition, userId);
  return { categoryId, status: plan.action === "create" ? "created" : "already present", drift: plan.drift };
};

const mongoPorts = (): BootstrapPorts => ({
  findActiveCategories: async (filter) => {
    const docs = await WorkflowBrainCategory.find(filter).limit(2).lean();
    return docs.map((doc) => ({
      _id: doc._id,
      name: doc.name,
      accessRole: doc.accessRole,
      groundingMode: doc.groundingMode,
      minEvidenceCount: doc.minEvidenceCount,
      isActive: doc.isActive,
    }));
  },
  hasInactiveCategory: async (name) => Boolean(await WorkflowBrainCategory.exists({ name, isActive: { $ne: true } })),
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
    if (result.status === "drift") {
      console.error(`Rod Pump Failure category exists (id=${result.categoryId}) but its settings differ from the intended ones:`);
      for (const setting of result.drift) {
        console.error(`DRIFT: ${setting} differs (intended: ${String(ROD_PUMP_CATEGORY_SETTINGS[setting as keyof typeof ROD_PUMP_CATEGORY_SETTINGS])}); left unchanged`);
      }
      console.error("Nothing was changed and the dataset definition was not registered. Fix the settings in the Brain UI (admin), then re-run.");
      process.exitCode = 1;
      return;
    }
    console.log(`Rod Pump Failure category ${result.status} (id=${result.categoryId})`);
    console.log(`Dataset definition "${rodPumpFailureDefinition.key}" registered (id=${result.categoryId})`);
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
