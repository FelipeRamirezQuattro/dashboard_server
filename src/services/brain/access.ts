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
