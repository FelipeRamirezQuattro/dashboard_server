/// <reference types="node" />
import {
  BrainAccessError,
  canChangeCategorySettings,
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

console.log("access fixtures passed");
