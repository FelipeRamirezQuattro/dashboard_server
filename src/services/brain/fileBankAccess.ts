import { roleHierarchy } from "../../utils/roleHierarchy";

/** File Bank records carrying this tag hold admin-only Brain knowledge originals. */
export const RESTRICTED_FILEBANK_TAG = "brain-document";

/**
 * Mongo filter fragment to merge into every File Bank read made on behalf of a user.
 * Admin and above see everything; any other (or unknown/missing) role excludes restricted records.
 */
export const fileBankVisibilityFilter = (role?: string | null): Record<string, unknown> => {
  const level = role ? (roleHierarchy as Record<string, number>)[role] : undefined;
  if (level !== undefined && level >= roleHierarchy.admin) return {};
  return { tags: { $ne: RESTRICTED_FILEBANK_TAG } };
};
