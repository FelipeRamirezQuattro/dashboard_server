/// <reference types="node" />
import { BrainAccessError } from "../../services/brain/access";
import {
  answerRodPumpQuestion,
  createTtlCache,
  decideRodPumpRoute,
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
// Legacy category without accessRole is viewer-level (effectiveAccessRole semantics).
assert(decideRodPumpRoute({ _id: "c2" }, "viewer") === "brain", "legacy category readable by viewer => brain");
assert(decideRodPumpRoute({ _id: "c2" }, undefined) === "fallback_pump_pro", "legacy category, unknown role => fallback");

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
