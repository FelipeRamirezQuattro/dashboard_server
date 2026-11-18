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

const good = { name: "Rod Pump Failure", accessRole: "admin", groundingMode: "strict", minEvidenceCount: 2, isActive: true };
same(planBootstrap([], false), { action: "create", drift: [] }, "nothing => create");
same(planBootstrap([good], false), { action: "noop", drift: [] }, "same => noop");
same(planBootstrap([good], true), { action: "noop", drift: [] }, "active + inactive namesake => use the active one");
same(planBootstrap([{ ...good, accessRole: "viewer" }], false), { action: "noop", drift: ["accessRole"] }, "viewer drift");
same(planBootstrap([{ ...good, accessRole: "editor" }], false), { action: "noop", drift: ["accessRole"] }, "editor drift");
same(planBootstrap([{ name: "Rod Pump Failure", isActive: true }], false), { action: "noop", drift: ["accessRole", "groundingMode", "minEvidenceCount"] }, "legacy (missing fields) drift");
same(planBootstrap([{ ...good, groundingMode: null, minEvidenceCount: null }], false), { action: "noop", drift: ["groundingMode", "minEvidenceCount"] }, "null fields drift");
same(planBootstrap([{ ...good, minEvidenceCount: 3, groundingMode: "standard" }], false), { action: "noop", drift: ["groundingMode", "minEvidenceCount"] }, "multi drift");
same(planBootstrap([{ ...good, isActive: undefined }], false), { action: "noop", drift: ["isActive"] }, "isActive drift");
// final review I6(a): an inactive namesake alone is never silently duplicated or reactivated
same(planBootstrap([], true), { action: "refuse", drift: [], reason: "inactive_only" }, "inactive only => refuse");
same(planBootstrap([good, { ...good }], false), { action: "refuse", drift: [], reason: "multiple_active" }, "two active namesakes => refuse");

// Idempotency with an in-memory fake store.
const run = async (): Promise<void> => {
  const store: { cats: Array<Record<string, unknown>>; defs: number; admin: string | null } = { cats: [], defs: 0, admin: "u1" };
  const lookups: unknown[] = [];
  const ports: BootstrapPorts = {
    findActiveCategories: async (filter) => {
      lookups.push(filter);
      return store.cats.filter((c) => c.name === filter.name && c.isActive === true) as never;
    },
    hasInactiveCategory: async (name) => store.cats.some((c) => c.name === name && c.isActive !== true),
    findAdminUserId: async () => store.admin,
    createCategory: async (data) => {
      const doc = { ...data, _id: `cat${store.cats.length + 1}` };
      store.cats.push(doc);
      return doc;
    },
    registerDefinition: async () => {
      store.defs += 1; // the real call is an upsert
    },
  };
  const first = await runBootstrap(ports);
  assert(first.status === "created" && store.cats.length === 1 && store.defs === 1, "first run creates");
  same(lookups[0], { name: ROD_PUMP_CATEGORY_NAME, isActive: true }, "lookup is { name, isActive: true }");
  const c = store.cats[0];
  assert(c.name === ROD_PUMP_CATEGORY_NAME && c.domain === "field_service" && c.accessRole === "admin" && c.groundingMode === "strict" && c.minEvidenceCount === 2 && c.isActive === true && c.createdBy === "u1", "category settings");
  const snapshot = JSON.stringify(store.cats);
  const second = await runBootstrap(ports);
  assert(second.status === "already present" && second.categoryId === first.categoryId, "second run already present");
  assert(JSON.stringify(store.cats) === snapshot && store.cats.length === 1, "second run changes nothing");

  // Admin-changed settings are reported (status "drift" => the CLI exits non-zero), never overwritten, and the
  // definition is not registered into a category whose settings differ.
  store.cats[0].accessRole = "viewer";
  const defsBefore = store.defs;
  const third = await runBootstrap(ports);
  assert(third.status === "drift" && third.drift.length === 1 && third.drift[0] === "accessRole" && store.cats[0].accessRole === "viewer", "drift reported, not modified");
  assert(store.defs === defsBefore, "no definition registered on drift");

  // An editor's viewer-readable namesake next to a soft-deleted original: refused, nothing created.
  store.cats = [{ ...c, isActive: false }];
  let threw = "";
  try {
    await runBootstrap(ports);
  } catch (e) {
    threw = (e as Error).message;
  }
  assert(/inactive/i.test(threw) && store.cats.length === 1 && store.cats[0].isActive === false, "inactive only => clear error, no duplicate, not reactivated");

  // No admin user => clear error.
  const empty = { ...ports, findActiveCategories: async () => [], hasInactiveCategory: async () => false, findAdminUserId: async () => null };
  threw = "";
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
