/// <reference types="node" />
import {
  BrainAccessError,
  canChangeCategorySettings,
  effectiveAccessRole,
  effectiveGroundingMode,
  effectiveMinEvidenceCount,
  roleMeets,
} from "../../services/brain/access";

import { roleHierarchy } from "../../utils/roleHierarchy";

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

type Role = "viewer" | "editor" | "admin" | "superadmin";
const roles: Role[] = ["viewer", "editor", "admin", "superadmin"];
const mins = ["viewer", "editor", "admin"] as const;
const rank: Record<string, number> = roleHierarchy;

assert(
  JSON.stringify(roleHierarchy) === JSON.stringify({ viewer: 1, editor: 2, admin: 3, superadmin: 4 }),
  "shared roleHierarchy values pinned",
);

for (const role of roles) {
  for (const min of mins) {
    assert(
      roleMeets(role, min) === rank[role] >= rank[min],
      `roleMeets(${role}, ${min}) should be ${rank[role] >= rank[min]}`,
    );
  }
}

const expectedSettings: Record<Role, boolean> = {
  viewer: false,
  editor: false,
  admin: true,
  superadmin: true,
};
for (const role of roles) {
  assert(
    canChangeCategorySettings(role) === expectedSettings[role],
    `canChangeCategorySettings(${role}) should be ${expectedSettings[role]}`,
  );
}

const err = new BrainAccessError("nope");
assert(err instanceof Error, "BrainAccessError must be an Error");
assert(err.status === 403, "BrainAccessError status must be 403");
assert(err.message === "nope", "BrainAccessError keeps message");

assert(effectiveAccessRole({}) === "viewer", "missing accessRole => viewer");
assert(effectiveAccessRole({ accessRole: null }) === "viewer", "null accessRole => viewer");
assert(effectiveAccessRole({ accessRole: undefined }) === "viewer", "undefined accessRole => viewer");
assert(effectiveAccessRole({ accessRole: "owner" }) === "admin", "unknown string fails closed to admin");
assert(effectiveAccessRole({ accessRole: "" }) === "admin", "empty string fails closed to admin");
assert(effectiveAccessRole({ accessRole: 5 as never }) === "admin", "non-string fails closed to admin");
for (const r of ["viewer", "editor", "admin"] as const) {
  assert(effectiveAccessRole({ accessRole: r }) === r, `valid ${r} kept`);
}
assert(effectiveGroundingMode({}) === "standard", "missing grounding => standard");
assert(effectiveGroundingMode({ groundingMode: null }) === "standard", "null grounding => standard");
assert(effectiveGroundingMode({ groundingMode: "strict" }) === "strict", "strict kept");
assert(effectiveGroundingMode({ groundingMode: "weird" }) === "standard", "unknown grounding => standard");
assert(effectiveMinEvidenceCount({}) === 2, "missing min => 2");
assert(effectiveMinEvidenceCount({ minEvidenceCount: null }) === 2, "null min => 2");
assert(effectiveMinEvidenceCount({ minEvidenceCount: Number.NaN }) === 2, "NaN min => 2");
assert(effectiveMinEvidenceCount({ minEvidenceCount: "3" as never }) === 2, "non-number min => 2");
assert(effectiveMinEvidenceCount({ minEvidenceCount: 0 }) === 1, "clamp low to 1");
assert(effectiveMinEvidenceCount({ minEvidenceCount: 99 }) === 10, "clamp high to 10");
assert(effectiveMinEvidenceCount({ minEvidenceCount: 4.7 }) === 4, "floored");
assert(effectiveMinEvidenceCount({ minEvidenceCount: 5 }) === 5, "valid kept");

console.log("access fixtures passed");
