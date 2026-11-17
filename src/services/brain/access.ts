import { UserRole } from "../../models/User.model";

import { roleHierarchy } from "../../utils/roleHierarchy";

export type CategoryAccessRole = "viewer" | "editor" | "admin";

export class BrainAccessError extends Error {
  status = 403;
  constructor(message = "Insufficient permissions") {
    super(message);
    this.name = "BrainAccessError";
  }
}

/**
 * Single place where legacy/missing category settings are interpreted. Anything reading a category
 * via .lean() (no schema defaults) MUST go through these helpers.
 * Missing/null accessRole (pre-feature categories) => "viewer"; an unknown value fails closed to "admin".
 */
export const effectiveAccessRole = (c: { accessRole?: string | null }): CategoryAccessRole => {
  const value = c?.accessRole;
  if (value === undefined || value === null) return "viewer";
  return value === "viewer" || value === "editor" || value === "admin" ? value : "admin";
};

export const effectiveGroundingMode = (c: { groundingMode?: string | null }): "strict" | "standard" =>
  c?.groundingMode === "strict" ? "strict" : "standard";

export const effectiveMinEvidenceCount = (c: { minEvidenceCount?: number | null }): number => {
  const value = c?.minEvidenceCount;
  if (typeof value !== "number" || !Number.isFinite(value)) return 2;
  return Math.min(10, Math.max(1, Math.floor(value)));
};

export const roleMeets = (userRole: UserRole, minRole: CategoryAccessRole): boolean =>
  (roleHierarchy[userRole] ?? 0) >= roleHierarchy[minRole];

export const canChangeCategorySettings = (userRole: UserRole): boolean =>
  roleMeets(userRole, "admin");

export const BRAIN_CHAT_ACCESS_DENIED_REPLY = "You don't have access to that Workflow Brain category.";

const KNOWN_ROLES: readonly UserRole[] = ["viewer", "editor", "admin", "superadmin"];

/** Narrows an untrusted role string; unknown or missing roles yield undefined (treated as no access). */
export const asKnownRole = (role: unknown): UserRole | undefined =>
  typeof role === "string" && (KNOWN_ROLES as readonly string[]).includes(role)
    ? (role as UserRole)
    : undefined;
