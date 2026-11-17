import type { UserRole } from "../../models/User.model";
import { CategoryAccessRole, roleMeets } from "./access";

export type CategoryAccessDecision = "ok" | "not_found" | "forbidden";

interface AccessCategory {
  accessRole: CategoryAccessRole;
  isActive?: boolean;
}

/** Pure decision: unknown or inactive category => not_found; role below accessRole => forbidden. */
export const decideCategoryAccess = (
  role: UserRole,
  category: AccessCategory | null | undefined,
): CategoryAccessDecision => {
  if (!category || category.isActive === false) return "not_found";
  return roleMeets(role, category.accessRole) ? "ok" : "forbidden";
};

export const filterReadableCategories = <T extends { accessRole: CategoryAccessRole }>(
  role: UserRole,
  categories: T[],
): T[] => categories.filter((category) => roleMeets(role, category.accessRole));
