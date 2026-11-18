import type { UserRole } from "../models/User.model";

// Leaf module (no express/logger imports) so pure helpers and fixtures can share the role levels.
export const roleHierarchy: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  superadmin: 4,
};
