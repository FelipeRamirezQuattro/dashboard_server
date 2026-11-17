import { BrainAccessError, asKnownRole, effectiveAccessRole, roleMeets } from "./access";
import type { Citation } from "./types";
import type { UserRole } from "../../models/User.model";
import logger from "../../utils/logger";

export const ROD_PUMP_CATEGORY_NAME = "Rod Pump Failure";
export const CATEGORY_CACHE_TTL_MS = 60_000;

export interface RodPumpCategory {
  _id: unknown;
  accessRole?: string | null;
  isActive?: boolean;
  name?: string;
}

export type RodPumpRoute = "brain" | "fallback_pump_pro";

/** Pure: brain only for an existing, active category the (known) role may read; everything else keeps the Pump Pro path. */
export const decideRodPumpRoute = (category: RodPumpCategory | null, role: string | undefined): RodPumpRoute => {
  if (!category || category.isActive === false) return "fallback_pump_pro";
  const known = asKnownRole(role);
  if (!known) return "fallback_pump_pro";
  return roleMeets(known, effectiveAccessRole(category)) ? "brain" : "fallback_pump_pro";
};

export interface TtlCache<T> {
  get(): T | undefined;
  set(value: T): void;
}

/** Single-slot cache with expiry; the clock is injectable for tests. */
export const createTtlCache = <T>(ttlMs: number, now: () => number = Date.now): TtlCache<T> => {
  let entry: { value: T; expiresAt: number } | undefined;
  return {
    get: () => (entry && now() < entry.expiresAt ? entry.value : undefined),
    set: (value) => {
      entry = { value, expiresAt: now() + ttlMs };
    },
  };
};

export type RodPumpAnswer =
  | { route: "brain"; reply: string; citations?: Citation[]; insufficient: boolean; categoryName: string }
  | { route: "fallback_pump_pro" };

export interface RodPumpPorts {
  findCategoryByName(name: string): Promise<RodPumpCategory | null>;
  answerQuestion(
    categoryId: string,
    message: string,
    user: { id: string; role: UserRole },
  ): Promise<{ answer: string; categoryName: string; citations?: Citation[]; insufficient?: boolean }>;
}

const categoryCache = createTtlCache<RodPumpCategory | null>(CATEGORY_CACHE_TTL_MS);

const defaultPorts = (): RodPumpPorts => {
  // Lazy requires keep this module importable (and fixture-testable) without loading mongoose models.
  /* eslint-disable @typescript-eslint/no-var-requires */
  return {
    findCategoryByName: async (name) => {
      const cached = categoryCache.get();
      if (cached !== undefined) return cached;
      const { WorkflowBrainCategory } = require("../../models/WorkflowBrain.model");
      const doc = await WorkflowBrainCategory.findOne({ name }).select("_id accessRole isActive name").lean();
      const value: RodPumpCategory | null = doc
        ? { _id: doc._id, accessRole: doc.accessRole, isActive: doc.isActive, name: doc.name }
        : null;
      categoryCache.set(value);
      return value;
    },
    answerQuestion: (categoryId, message, user) => {
      const { workflowBrainChatService } = require("../workflowBrainChat.service");
      return workflowBrainChatService.answerQuestion(categoryId, message, user);
    },
  };
};

export const answerRodPumpQuestion = async (
  p: { message: string; user: { id: string; role: string } },
  ports: RodPumpPorts = defaultPorts(),
): Promise<RodPumpAnswer> => {
  let categoryId = "";
  try {
    const category = await ports.findCategoryByName(ROD_PUMP_CATEGORY_NAME);
    if (decideRodPumpRoute(category, p.user.role) !== "brain" || !category) {
      return { route: "fallback_pump_pro" };
    }
    categoryId = String(category._id);
    const role = asKnownRole(p.user.role) as UserRole;
    const result = await ports.answerQuestion(categoryId, p.message, { id: p.user.id, role });
    return {
      route: "brain",
      reply: result.answer,
      citations: result.citations,
      insufficient: Boolean(result.insufficient),
      categoryName: result.categoryName || ROD_PUMP_CATEGORY_NAME,
    };
  } catch (error) {
    if (!(error instanceof BrainAccessError)) {
      logger.warn(`[RodPumpChat] falling back to Pump Pro: ${error instanceof Error ? error.name : "UnknownError"} categoryId=${categoryId}`);
    }
    return { route: "fallback_pump_pro" };
  }
};
