/// <reference types="node" />
import { BrainAccessError } from "../../services/brain/access";
import {
  answerRodPumpQuestion,
  createTtlCache,
  decideRodPumpRoute,
  ROD_PUMP_CATEGORY_NAME,
  rodPumpCategoryFilter,
  RodPumpPorts,
} from "../../services/brain/rodPumpChat";

const assert = (condition: unknown, message: string): void => {
  if (!condition) throw new Error(message);
};

const adminCat = { _id: "c1", accessRole: "admin", isActive: true };

// decideRodPumpRoute matrix
assert(decideRodPumpRoute(adminCat, "admin") === "brain", "admin => brain");
assert(decideRodPumpRoute(adminCat, "superadmin") === "brain", "superadmin => brain");
for (const role of ["editor", "viewer", undefined, "owner", ""]) {
  assert(decideRodPumpRoute(adminCat, role) === "fallback_pump_pro", `role ${String(role)} => fallback`);
}
assert(decideRodPumpRoute(null, "admin") === "fallback_pump_pro", "null category => fallback");
assert(decideRodPumpRoute({ ...adminCat, isActive: false }, "admin") === "fallback_pump_pro", "inactive => fallback");
// final review I6: only an ACTIVE category whose effective accessRole is exactly "admin" is the Rod Pump Brain; a
// namesake an editor created (viewer/editor-readable, or legacy without accessRole) never receives the auto-route.
for (const role of ["admin", "superadmin", "viewer", "editor"]) {
  for (const accessRole of ["viewer", "editor", undefined, null]) {
    assert(decideRodPumpRoute({ _id: "c2", accessRole, isActive: true }, role) === "fallback_pump_pro", `accessRole ${String(accessRole)}, role ${role} => fallback`);
  }
  assert(decideRodPumpRoute({ _id: "c2", accessRole: "admin" }, role) === "fallback_pump_pro", `isActive missing, role ${role} => fallback`);
  assert(decideRodPumpRoute({ _id: "c2", accessRole: "admin", isActive: false }, role) === "fallback_pump_pro", `inactive, role ${role} => fallback`);
}
// unknown stored values fail closed to admin (effectiveAccessRole): admin-only, never viewer-readable
assert(decideRodPumpRoute({ _id: "c2", accessRole: "ADMIN", isActive: true }, "viewer") === "fallback_pump_pro", "unknown accessRole, viewer => fallback");
assert(rodPumpCategoryFilter(ROD_PUMP_CATEGORY_NAME).isActive === true && rodPumpCategoryFilter(ROD_PUMP_CATEGORY_NAME).name === "Rod Pump Failure", "lookup filter is { name, isActive: true }");

// answerRodPumpQuestion with fake ports
const makePorts = (
  category: typeof adminCat | null,
  answer: RodPumpPorts["answerQuestion"],
): { ports: RodPumpPorts; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    ports: {
      findCategoryByName: async (name) => {
        calls.push(`find:${name}`);
        return category;
      },
      answerQuestion: async (...args) => {
        calls.push("answer");
        return answer(...args);
      },
    },
  };
};

const ok: RodPumpPorts["answerQuestion"] = async (id, _m, user) => {
  assert(id === "c1" && user.role === "admin" && user.id === "u1", "answerQuestion receives category id and user");
  return {
    answer: "Because of X.",
    categoryName: "Rod Pump Failure",
    citations: [{ title: "r" } as never],
    insufficient: false,
    status: "answered",
  };
};

const run = async (): Promise<void> => {
  const user = { id: "u1", role: "admin" };
  const a = makePorts(adminCat, ok);
  const r1 = await answerRodPumpQuestion({ message: "why did ACS-1228 fail", user }, a.ports);
  assert(r1.route === "brain", "admin => brain route");
  if (r1.route === "brain") {
    assert(r1.reply === "Because of X." && r1.citations?.length === 1 && r1.insufficient === false, "citations passed through");
    assert(r1.categoryName === "Rod Pump Failure", "category name");
  }
  assert(a.calls[0] === "find:Rod Pump Failure", "looked up by exact name");
  if (r1.route === "brain") assert(r1.status === "answered", "status passed through");

  // final review I3: an unavailable answer service stays on the brain route with status "unavailable"
  const down = makePorts(adminCat, async () => ({ answer: "The answer service is temporarily unavailable. Please try again in a moment.", categoryName: "Rod Pump Failure", citations: [], insufficient: false, status: "unavailable" as const }));
  const r0 = await answerRodPumpQuestion({ message: "x", user }, down.ports);
  assert(r0.route === "brain" && r0.status === "unavailable" && r0.insufficient === false, "unavailable status passed through");

  const v = makePorts(adminCat, ok);
  const r2 = await answerRodPumpQuestion({ message: "x", user: { id: "u2", role: "viewer" } }, v.ports);
  assert(r2.route === "fallback_pump_pro" && !v.calls.includes("answer"), "viewer => fallback, answerQuestion not called");

  const d = makePorts(adminCat, async () => {
    throw new BrainAccessError();
  });
  assert((await answerRodPumpQuestion({ message: "x", user }, d.ports)).route === "fallback_pump_pro", "BrainAccessError => fallback");

  const e = makePorts(adminCat, async () => {
    throw new Error("boom with secret content");
  });
  assert((await answerRodPumpQuestion({ message: "x", user }, e.ports)).route === "fallback_pump_pro", "other error => fallback");

  const m = makePorts(null, ok);
  assert((await answerRodPumpQuestion({ message: "x", user }, m.ports)).route === "fallback_pump_pro" && !m.calls.includes("answer"), "missing category => fallback");

  const f: RodPumpPorts = {
    findCategoryByName: async () => {
      throw new Error("db down");
    },
    answerQuestion: ok,
  };
  assert((await answerRodPumpQuestion({ message: "x", user }, f)).route === "fallback_pump_pro", "lookup error => fallback");

  // createTtlCache
  let t = 1000;
  const cache = createTtlCache<{ _id: string } | null>(60_000, () => t);
  assert(cache.get() === undefined, "empty cache miss");
  const value = { _id: "c1" };
  cache.set(value);
  t += 59_999;
  assert(cache.get() === value, "hit within TTL returns same value");
  t += 1;
  assert(cache.get() === undefined, "miss after TTL");
  cache.set(null);
  assert(cache.get() === null, "null (no category) is cacheable");

  console.log("rodPumpChat fixtures passed");
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
