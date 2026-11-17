/// <reference types="node" />
import {
  BootstrapPorts,
  planBootstrap,
  ROD_PUMP_CATEGORY_NAME,
  runBootstrap,
} from "../../scripts/registerRodPumpBrain";

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};
const same = (a: unknown, b: unknown, message: string): void => assert(JSON.stringify(a) === JSON.stringify(b), `${message}: ${JSON.stringify(a)}`);

const good = { name: "Rod Pump Failure", accessRole: "admin", groundingMode: "strict", minEvidenceCount: 2 };
same(planBootstrap(null), { action: "create", drift: [] }, "null => create");
same(planBootstrap(good), { action: "noop", drift: [] }, "same => noop");
same(planBootstrap({ ...good, accessRole: "viewer" }), { action: "noop", drift: ["accessRole"] }, "viewer drift");
same(planBootstrap({ name: "Rod Pump Failure" }), { action: "noop", drift: ["accessRole", "groundingMode", "minEvidenceCount"] }, "legacy drift");
same(planBootstrap({ ...good, minEvidenceCount: 3, groundingMode: "standard" }), { action: "noop", drift: ["groundingMode", "minEvidenceCount"] }, "multi drift");

// Idempotency with an in-memory fake store.
const run = async (): Promise<void> => {
  const store: { cats: Array<Record<string, unknown>>; defs: number; admin: string | null } = { cats: [], defs: 0, admin: "u1" };
  const ports: BootstrapPorts = {
    findCategory: async (name) => (store.cats.find((c) => c.name === name) as never) ?? null,
    findAdminUserId: async () => store.admin,
    createCategory: async (data) => {
      const doc = { ...data, _id: `cat${store.cats.length + 1}` };
      store.cats.push(doc);
      return doc;
    },
    registerDefinition: async () => {
      store.defs = 1; // upsert: still exactly one
    },
  };
  const first = await runBootstrap(ports);
  assert(first.status === "created" && store.cats.length === 1, "first run creates");
  const c = store.cats[0];
  assert(c.name === ROD_PUMP_CATEGORY_NAME && c.domain === "field_service" && c.accessRole === "admin" && c.groundingMode === "strict" && c.minEvidenceCount === 2 && c.isActive === true && c.createdBy === "u1", "category settings");
  const snapshot = JSON.stringify(store.cats);
  const second = await runBootstrap(ports);
  assert(second.status === "already present" && second.categoryId === first.categoryId, "second run already present");
  assert(JSON.stringify(store.cats) === snapshot && store.cats.length === 1 && store.defs === 1, "second run changes nothing");

  // Admin-changed settings are reported, never overwritten.
  store.cats[0].accessRole = "viewer";
  const third = await runBootstrap(ports);
  assert(third.drift.length === 1 && third.drift[0] === "accessRole" && store.cats[0].accessRole === "viewer", "drift reported, not modified");

  // No admin user => clear error.
  const empty = { ...ports, findCategory: async () => null, findAdminUserId: async () => null };
  let threw = "";
  try {
    await runBootstrap(empty);
  } catch (e) {
    threw = (e as Error).message;
  }
  assert(/No superadmin or admin user/.test(threw), "errors clearly without admin");
  console.log("bootstrap fixtures passed");
};
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
