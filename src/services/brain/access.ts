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
