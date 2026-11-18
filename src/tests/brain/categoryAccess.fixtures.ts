/// <reference types="node" />
import { decideCategoryAccess, filterReadableCategories } from "../../services/brain/categoryAccess";

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const cat = (accessRole: "viewer" | "editor" | "admin", isActive = true) => ({ accessRole, isActive });

assert(decideCategoryAccess("viewer", null) === "not_found", "null => not_found");
assert(decideCategoryAccess("admin", cat("viewer", false)) === "not_found", "inactive => not_found even for admin");
assert(decideCategoryAccess("superadmin", cat("admin", false)) === "not_found", "inactive => not_found for superadmin");
for (const role of ["viewer", "editor", "admin", "superadmin"] as const) {
  assert(decideCategoryAccess(role, cat("viewer")) === "ok", `${role} reads viewer-level`);
}
assert(decideCategoryAccess("viewer", cat("editor")) === "forbidden", "viewer vs editor => forbidden");
assert(decideCategoryAccess("editor", cat("editor")) === "ok", "editor vs editor ok");
assert(decideCategoryAccess("viewer", cat("admin")) === "forbidden", "viewer vs admin => forbidden");
assert(decideCategoryAccess("editor", cat("admin")) === "forbidden", "editor vs admin => forbidden");
assert(decideCategoryAccess("admin", cat("admin")) === "ok", "admin vs admin ok");
assert(decideCategoryAccess("superadmin", cat("admin")) === "ok", "superadmin vs admin ok");
assert(decideCategoryAccess(undefined as never, cat("viewer")) === "forbidden", "missing role => forbidden");
assert(decideCategoryAccess("bogus" as never, cat("viewer")) === "forbidden", "unknown role => forbidden");

const list = [
  { name: "a", accessRole: "viewer" as const },
  { name: "b", accessRole: "editor" as const },
  { name: "c", accessRole: "admin" as const },
];
const names = (role: never) => filterReadableCategories(role, list).map((c) => c.name).join("");
assert(names("viewer" as never) === "a", "viewer sees only viewer-level");
assert(names("editor" as never) === "ab", "editor sees viewer+editor");
assert(names("admin" as never) === "abc", "admin sees all");
assert(names("bogus" as never) === "", "unknown role sees nothing");
for (const role of ["viewer", "editor", "admin", "superadmin"] as const) {
  assert(decideCategoryAccess(role, { isActive: true } as never) === "ok", `${role} reads legacy (missing accessRole)`);
  assert(
    decideCategoryAccess(role, { accessRole: null, isActive: true } as never) === "ok",
    `${role} reads legacy (null accessRole)`,
  );
}
assert(decideCategoryAccess("superadmin", { isActive: true } as never) === "ok", "superadmin legacy ok");
for (const role of ["viewer", "editor"] as const) {
  assert(decideCategoryAccess(role, { accessRole: "owner", isActive: true } as never) === "forbidden", `${role} vs unknown => forbidden`);
}
assert(decideCategoryAccess("admin", { accessRole: "owner", isActive: true } as never) === "ok", "admin vs unknown ok");
const mixed = [{ name: "legacy" }, { name: "e", accessRole: "editor" }, { name: "u", accessRole: "owner" }] as never[];
const mnames = (role: never) => (filterReadableCategories(role, mixed) as { name: string }[]).map((c) => c.name).join(",");
assert(mnames("viewer" as never) === "legacy", "viewer sees legacy only");
assert(mnames("editor" as never) === "legacy,e", "editor sees legacy+editor");
assert(mnames("admin" as never) === "legacy,e,u", "admin sees all incl. unknown");
console.log("categoryAccess fixtures OK");
