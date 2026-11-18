/// <reference types="node" />
import * as fileBankAccess from "../../services/brain/fileBankAccess";
import { RESTRICTED_FILEBANK_TAG, fileBankVisibilityFilter } from "../../services/brain/fileBankAccess";

const eq = (a: unknown, b: unknown, m: string): void => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
};
const restricted = { tags: { $ne: RESTRICTED_FILEBANK_TAG } };
eq(RESTRICTED_FILEBANK_TAG, "brain-document", "tag");
for (const r of ["viewer", "editor", "nonsense", undefined, null, ""]) eq(fileBankVisibilityFilter(r as string), restricted, `role ${r}`);
for (const r of ["admin", "superadmin"]) eq(fileBankVisibilityFilter(r), {}, `role ${r}`);
// final review S3: multer decodes multipart filenames as latin1; recover the UTF-8 name when it round-trips cleanly
const fix = (fileBankAccess as { fixMulterFilename?: (n: string) => string }).fixMulterFilename;
eq(typeof fix, "function", "fixMulterFilename exported");
if (fix) {
  eq(fix("\u00C3\u00B1o.pdf"), "\u00F1o.pdf", "mojibake Ã±o.pdf => ño.pdf");
  eq(fix("n\u00C3\u00B1o.pdf"), "n\u00F1o.pdf", "mojibake nÃ±o.pdf => nño.pdf");
  eq(fix(Buffer.from("Informe de válvulas – Señal.pdf", "utf8").toString("latin1")), "Informe de válvulas – Señal.pdf", "Spanish name with en dash");
  eq(fix("plain-ascii_1.pdf"), "plain-ascii_1.pdf", "ASCII unchanged");
  eq(fix("\u00F1o.pdf"), "\u00F1o.pdf", "already UTF-8 (latin1-range, not valid as bytes) unchanged");
  eq(fix("caf\u00E9 \u2713.pdf"), "caf\u00E9 \u2713.pdf", "chars beyond latin1 => unchanged");
  eq(fix(""), "", "empty");
}
console.log("fileBankAccess fixtures OK");
