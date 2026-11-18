import type { UserRole } from "../models/User.model";

// Leaf module (no express/logger imports) so pure helpers and fixtures can share the role levels.
export const roleHierarchy: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  superadmin: 4,
};

/**
 * Role to store on an SSO login. The SSO_*_EMAILS env lists are bootstrap grants:
 * they can raise a role but must never lower one an admin set in the app.
 * New users have no existing role and get the env role (viewer by default).
 */
export const resolveSsoRole = (
  existingRole: UserRole | undefined,
  envRole: UserRole,
): UserRole => {
  if (!existingRole) return envRole;
  return roleHierarchy[envRole] > roleHierarchy[existingRole]
    ? envRole
    : existingRole;
};
