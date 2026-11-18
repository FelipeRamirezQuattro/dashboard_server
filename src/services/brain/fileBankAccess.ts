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

/**
 * multer (busboy) decodes multipart filenames as latin1, so "Señal.pdf" arrives as "SeÃ±al.pdf". When every char is in
 * the latin1 range, at least one is non-ASCII, and re-reading those bytes as UTF-8 yields a string without U+FFFD, the
 * UTF-8 reading is the real name. ASCII names and names that are not valid UTF-8 bytes are returned unchanged.
 */
export const fixMulterFilename = (name: string): string => {
  if (!name || !/[\u0080-\u00FF]/.test(name) || /[^\u0000-\u00FF]/.test(name)) return name;
  const decoded = Buffer.from(name, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") ? name : decoded;
};
