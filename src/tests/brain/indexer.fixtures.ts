/// <reference types="node" />
import fs from "fs";
import path from "path";
import { validateDataset } from "../../services/brain/datasetValidator";
import { rodPumpFailureDefinition as def } from "../../services/brain/definitions/rodPumpFailure";
import { buildRecordCards } from "../../services/brain/recordCards";
import { EmbeddingError, EmbeddingProvider, embedInBatches, prepareEmbeddingInputs, truncateForEmbedding } from "../../services/brain/embeddingProvider";
import {
  buildChunkEmbeddingText,
  createJobGuard,
  createLimiter,
  resolveDatasetJobOutcome,
  needsReembedding,
  rebuildCardsFromActiveRecords,
  runEmbeddingJob,
  selectActiveRecords,
} from "../../services/brain/indexerCore";

const assert = (c: unknown, m: string): void => {
  if (!c) throw new Error(m);
};
const cases: { name: string; run: () => Promise<void> | void }[] = [];
const test = (name: string, run: () => Promise<void> | void): void => {
  cases.push({ name, run });
};
const rejectsWith = async (p: Promise<unknown>): Promise<unknown> => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected rejection");
};

const fake = (onCall?: (n: number, texts: string[]) => number[][] | undefined): EmbeddingProvider & { calls: string[][] } => {
  const calls: string[][] = [];
  return {
    model: "fake-model",
    version: "9",
    calls,
    async embed(texts: string[]) {
      calls.push(texts);
      const custom = onCall?.(calls.length, texts);
      if (custom) return custom;
      return texts.map((t) => [Number(t.replace(/\D/g, "")) || 0, 1]);
    },
  };
};

test("embedInBatches: 130 texts / 64 => 3 calls, order preserved", async () => {
  const p = fake();
  const texts = Array.from({ length: 130 }, (_, i) => `t${i + 1}`);
  const out = await embedInBatches(p, texts, 64);
  assert(p.calls.length === 3 && p.calls.map((c) => c.length).join() === "64,64,2", "batch sizes");
  assert(out.length === 130 && out.every((v, i) => v[0] === i + 1), "order");
});

test("embedInBatches: mismatched count / NaN / empty vector => EmbeddingError", async () => {
  const short = fake(() => [[1]]);
  assert((await rejectsWith(embedInBatches(short, ["a", "b"]))) instanceof EmbeddingError, "count");
  const nan = fake(() => [[Number.NaN, 1]]);
  assert((await rejectsWith(embedInBatches(nan, ["a"]))) instanceof EmbeddingError, "nan");
  const empty = fake(() => [[]]);
  assert((await rejectsWith(embedInBatches(empty, ["a"]))) instanceof EmbeddingError, "empty");
});

test("embedInBatches: provider throws on 2nd call => EmbeddingError without input text", async () => {
  const p: EmbeddingProvider = {
    model: "m",
    version: "1",
    async embed(texts) {
      if (texts[0] === "SECRET-second") throw new Error("boom SECRET-second");
      return texts.map(() => [1]);
    },
  };
  const e = (await rejectsWith(embedInBatches(p, ["first", "SECRET-second"], 1))) as Error;
  assert(e instanceof EmbeddingError, "type");
  assert(!e.message.includes("SECRET") && !String(e.stack).includes("SECRET"), "no leaked text");
});

test("truncateForEmbedding caps at 8000 chars", () => {
  assert(truncateForEmbedding("a".repeat(9000)).length === 8000, "cap");
  assert(truncateForEmbedding("short") === "short", "short unchanged");
});

test("buildChunkEmbeddingText", () => {
  assert(buildChunkEmbeddingText("Head", "Body") === "Head\nBody", "with heading");
  assert(buildChunkEmbeddingText("", "Body") === "Body", "empty heading");
  assert(buildChunkEmbeddingText(undefined, "Body") === "Body", "undefined heading");
  assert(buildChunkEmbeddingText("  ", "Body") === "Body", "blank heading");
});

test("needsReembedding matrix", () => {
  const prov = { model: "m", version: "1" };
  const emb = [0.1];
  assert(needsReembedding({}, prov), "missing embedding");
  assert(needsReembedding({ embedding: [], embeddingModel: "m", embeddingVersion: "1" }, prov), "empty embedding");
  assert(needsReembedding({ embedding: emb, embeddingModel: "x", embeddingVersion: "1" }, prov), "model differs");
  assert(needsReembedding({ embedding: emb, embeddingModel: "m", embeddingVersion: "2" }, prov), "version differs");
  assert(!needsReembedding({ embedding: emb, embeddingModel: "m", embeddingVersion: "1" }, prov), "current");
  assert(!needsReembedding({ embeddedAt: new Date(), embeddingModel: "m", embeddingVersion: "1" }, prov), "embeddedAt implies vector");
  assert(needsReembedding({ embeddedAt: new Date(), embeddingModel: "m", embeddingVersion: "2" }, prov), "embeddedAt but version differs");
  assert(needsReembedding({ embeddingModel: "m", embeddingVersion: "1" }, prov), "no vector, no embeddedAt");
});

const dir = path.resolve(__dirname, "data/rod-pump-engine-sample");
const files: Record<string, string> = {};
for (const n of ["cases", "components", "wear", "solids", "actions", "evidence"]) {
  files[`${n}.csv`] = fs.readFileSync(path.join(dir, `${n}.csv`), "utf8");
}
const report = validateDataset(def, files);
const rowsByTable = report.rows as Record<string, Record<string, unknown>[]>;
const asRecords = (status = "active") =>
  Object.entries(rowsByTable).flatMap(([table, rows]) => rows.map((data) => ({ table, data, status })));

test("rebuildCardsFromActiveRecords matches buildRecordCards on the same rows", () => {
  const expected = buildRecordCards(def, rowsByTable).map((c) => ({ primaryKeyValue: c.primaryKeyValue, text: c.text }));
  const got = rebuildCardsFromActiveRecords(def, asRecords());
  assert(expected.length > 0, "sample has cards");
  assert(JSON.stringify(got) === JSON.stringify(expected), "identical cards");
});

test("selectActiveRecords drops superseded and rolled_back (caller filter)", () => {
  const all = [...asRecords("active"), { table: "cases", data: { case_id: "STALE-ZZ1" }, status: "superseded" }, { table: "cases", data: { case_id: "STALE-ZZ2" }, status: "rolled_back" }];
  const active = selectActiveRecords(all);
  assert(active.length === asRecords().length && active.every((r) => r.status === "active"), "only active");
  const texts = rebuildCardsFromActiveRecords(def, active).map((c) => c.text).join("\n");
  assert(!texts.includes("STALE-ZZ"), "stale rows absent from cards");
});

test("runEmbeddingJob: provider failing => failed, no writes", async () => {
  const writes: unknown[] = [];
  const p: EmbeddingProvider = { model: "m", version: "1", async embed() { throw new Error("x"); } };
  const r = await runEmbeddingJob({ items: [{ id: "a", text: "t" }], provider: p, write: async (w) => void writes.push(w) });
  assert(r.status === "failed" && writes.length === 0, "failed, no writes");
});

test("runEmbeddingJob: no provider => failed", async () => {
  const r = await runEmbeddingJob({ items: [{ id: "a", text: "t" }], provider: null, write: async () => undefined });
  assert(r.status === "failed", "failed");
});

test("runEmbeddingJob: success writes ids with model/version; skips current unless force", async () => {
  const p = fake();
  const writes: { id: string; embedding: number[]; embeddingModel: string; embeddingVersion: string }[] = [];
  const items = [
    { id: "a", text: "t1" },
    { id: "b", text: "t2", current: { embedding: [1], embeddingModel: "fake-model", embeddingVersion: "9" } },
    { id: "c", text: "t3" },
  ];
  const r = await runEmbeddingJob({ items, provider: p, write: async (w) => void writes.push(...w) });
  assert(r.status === "done" && r.embedded === 2, "done 2");
  assert(writes.map((w) => w.id).join() === "a,c", "ids");
  assert(writes.every((w) => w.embeddingModel === "fake-model" && w.embeddingVersion === "9" && w.embedding.length === 2), "model/version");
  writes.length = 0;
  const f = await runEmbeddingJob({ items, provider: p, force: true, write: async (w) => void writes.push(...w) });
  assert(f.embedded === 3 && writes.length === 3, "force embeds all");
});

test("runEmbeddingJob: write batches <= 500", async () => {
  const p = fake();
  const sizes: number[] = [];
  const items = Array.from({ length: 1100 }, (_, i) => ({ id: `i${i}`, text: `t${i}` }));
  await runEmbeddingJob({ items, provider: p, write: async (w) => void sizes.push(w.length) });
  assert(sizes.join() === "500,500,100", `sizes ${sizes}`);
});

test("job guard prevents re-entrancy", () => {
  const g = createJobGuard();
  assert(g.tryAcquire("doc:1"), "first");
  assert(!g.tryAcquire("doc:1"), "second no-op");
  assert(g.tryAcquire("batch:1"), "other key ok");
  g.release("doc:1");
  assert(g.tryAcquire("doc:1"), "after release");
});

test("prepareEmbeddingInputs: truncates, replaces empty, keeps count/order", () => {
  const out = prepareEmbeddingInputs(["a", "", "   \n", "b".repeat(9000)]);
  assert(out.length === 4 && out[0] === "a", "count/order");
  assert(out[1] === "(empty)" && out[2] === "(empty)", "empty replaced");
  assert(out[3].length === 8000, "truncated");
});

test("resolveDatasetJobOutcome", () => {
  assert(resolveDatasetJobOutcome(null) === "failed", "null");
  assert(resolveDatasetJobOutcome(undefined) === "failed", "undefined");
  assert(resolveDatasetJobOutcome({ ...def, card: undefined }) === "skip_done", "no card");
  assert(resolveDatasetJobOutcome(def) === "embed", "card");
});

test("guard: running + 2 more calls => exactly one rerun", () => {
  const g = createJobGuard();
  assert(g.tryAcquire("k"), "acquire");
  assert(!g.tryAcquire("k") && !g.tryAcquire("k"), "two misses");
  assert(g.release("k") === true, "rerun needed");
  assert(g.tryAcquire("k"), "rerun acquires");
  assert(g.release("k") === false, "no further rerun");
});

test("limiter: never more than max running, all complete, throw does not wedge", async () => {
  const lim = createLimiter(2);
  let active = 0;
  let peak = 0;
  const done: number[] = [];
  const task = (i: number) => async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    if (i === 3) throw new Error("boom");
    done.push(i);
    return i;
  };
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => lim(task(i))));
  assert(peak === 2, `peak ${peak}`);
  assert(done.length === 7, "7 succeeded");
  assert(results[3].status === "rejected" && results.filter((r) => r.status === "fulfilled").length === 7, "one rejected, rest ok");
});

(async () => {
  for (const c of cases) {
    try {
      await c.run();
    } catch (e) {
      console.error(`FAIL ${c.name}: ${(e as Error).message}`);
      process.exit(1);
    }
  }
  console.log(`indexer fixtures OK (${cases.length})`);
})();
