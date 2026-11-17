import type { UserRole } from "../../models/User.model";
import { effectiveAccessRole, roleMeets } from "./access";

export type CategoryAccessDecision = "ok" | "not_found" | "forbidden";

interface AccessCategory {
  accessRole?: string | null;
  isActive?: boolean;
}

/** Pure decision: unknown or inactive category => not_found; role below accessRole => forbidden. */
export const decideCategoryAccess = (
  role: UserRole,
  category: AccessCategory | null | undefined,
): CategoryAccessDecision => {
  if (!category || category.isActive === false) return "not_found";
  return roleMeets(role, effectiveAccessRole(category)) ? "ok" : "forbidden";
};

export const filterReadableCategories = <T extends { accessRole?: string | null }>(
  role: UserRole,
  categories: T[],
): T[] => categories.filter((category) => roleMeets(role, effectiveAccessRole(category)));
