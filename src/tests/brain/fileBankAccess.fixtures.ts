/// <reference types="node" />
import { RESTRICTED_FILEBANK_TAG, fileBankVisibilityFilter } from "../../services/brain/fileBankAccess";

const eq = (a: unknown, b: unknown, m: string): void => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const restricted = { tags: { $ne: RESTRICTED_FILEBANK_TAG } };
eq(RESTRICTED_FILEBANK_TAG, "brain-document", "tag");
for (const r of ["viewer", "editor", "nonsense", undefined, null, ""]) eq(fileBankVisibilityFilter(r as string), restricted, `role ${r}`);
for (const r of ["admin", "superadmin"]) eq(fileBankVisibilityFilter(r), {}, `role ${r}`);
console.log("fileBankAccess fixtures OK");
