import { UserRole } from "../../models/User.model";

// Same values as roleHierarchy in src/middleware/role.middleware.ts. Duplicated on purpose:
// importing that module pulls express/logger and the Request augmentation into this pure helper
// (and breaks standalone ts-node fixtures). Keep the two tables in sync.
const roleHierarchy: Record<UserRole | CategoryAccessRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  superadmin: 4,
};

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
