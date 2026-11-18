import assert from "assert";
import { resolveSsoRole } from "../utils/roleHierarchy";

// Regression: an admin promoted in the app must not be reset to viewer on the next SSO login.
assert.strictEqual(resolveSsoRole("admin", "viewer"), "admin");
assert.strictEqual(resolveSsoRole("editor", "viewer"), "editor");
assert.strictEqual(resolveSsoRole("superadmin", "viewer"), "superadmin");
// Env lists still grant/raise.
assert.strictEqual(resolveSsoRole("viewer", "admin"), "admin");
assert.strictEqual(resolveSsoRole("admin", "superadmin"), "superadmin");
// New users.
assert.strictEqual(resolveSsoRole(undefined, "viewer"), "viewer");
assert.strictEqual(resolveSsoRole(undefined, "editor"), "editor");
console.log("ssoRole fixtures passed");
