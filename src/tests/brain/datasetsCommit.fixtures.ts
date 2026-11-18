/// <reference types="node" />
// Offline simulation of commit/rollback against an in-memory fake of the mongoose statics. No database.
import mongoose from "mongoose";
import FileBank from "../../models/FileBank.model";
import {
  BrainDatasetDefinitionRecord,
  BrainDatasetRecord,
  BrainImportBatch,
} from "../../models/BrainKnowledge.model";
import * as svc from "../../services/brain/datasets.service";

const assert = (cond: unknown, message: string): void => {
  if (!cond) throw new Error(message);
};

const def = {
  key: "t1",
  version: "1",
  label: "T",
  tables: [
    {
      name: "cases",
      file: "cases.csv",
      required: true,
      primaryKey: ["a", "b"],
      columns: [
        { name: "a", type: "string", required: true },
        { name: "b", type: "string", required: true },
        { name: "v", type: "string" },
      ],
      references: [],
      checks: [],
    },
  ],
  card: { rootTable: "cases", include: [] },
};

type Doc = Record<string, any>;
let recs: Doc[] = [];
let batches: Doc[] = [];
let failNext: { op: string; times: number } | null = null;

const same = (a: unknown, b: unknown): boolean => String(a) === String(b);
const match = (d: Doc, f: Doc): boolean =>
  Object.entries(f).every(([k, v]: [string, any]) => {
    const dv = d[k];
    if (v && typeof v === "object" && !(v instanceof mongoose.Types.ObjectId) && !(v instanceof Date)) {
      if ("$in" in v) return v.$in.map(String).includes(String(dv));
      if ("$ne" in v) return !same(dv, v.$ne);
      if ("$gt" in v) return dv !== undefined && dv > v.$gt;
    }
    return same(dv, v);
  });
const chain = (val: () => any): any => {
  const c: any = { select: () => c, lean: async () => val(), then: (r: any, j: any) => Promise.resolve(val()).then(r, j) };
  return c;
};
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));
const maybeFail = (op: string): void => {
  if (failNext && failNext.op === op && failNext.times > 0) {
    failNext.times -= 1;
    throw new Error("injected failure");
  }
};
const dupKey = (): Error => Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
const applyUpdate = (d: Doc, u: Doc): void => {
  Object.assign(d, u.$set ?? {});
  for (const k of Object.keys(u.$unset ?? {})) delete d[k];
};

(BrainDatasetDefinitionRecord as any).findOne = () => chain(() => ({ definition: def }));
(FileBank as any).aggregate = async () => [];
(BrainDatasetRecord as any).find = (f: Doc) => chain(() => recs.filter((d) => match(d, f)).map((d) => ({ ...d })));
(BrainDatasetRecord as any).insertMany = async (docs: Doc[]) => {
  await tick();
  maybeFail("insertMany");
  for (const d of docs) {
    // unique index (categoryId, datasetKey, table, primaryKeyValue, revision); ordered: stops at the first conflict
    if (recs.some((r) => same(r.categoryId, d.categoryId) && r.datasetKey === d.datasetKey && r.table === d.table && r.primaryKeyValue === d.primaryKeyValue && r.revision === d.revision)) throw dupKey();
    recs.push({ ...d, _id: new mongoose.Types.ObjectId() });
  }
};
(BrainDatasetRecord as any).updateMany = async (f: Doc, u: Doc) => {
  await tick();
  maybeFail("updateMany");
  for (const d of recs) if (match(d, f)) applyUpdate(d, u);
};
(BrainDatasetRecord as any).deleteMany = async (f: Doc) => {
  await tick();
  recs = recs.filter((d) => !match(d, f));
};
(BrainImportBatch as any).create = async (b: Doc) => {
  const x = { ...b, _id: new mongoose.Types.ObjectId() };
  batches.push(x);
  return x;
};
(BrainImportBatch as any).findById = async (id: unknown) => {
  await tick();
  const b = batches.find((x) => same(x._id, id));
  return b ? { ...b } : null;
};
(BrainImportBatch as any).findOneAndUpdate = async (f: Doc, u: Doc) => {
  await tick(); // match + update below run with no await between them: atomic like Mongo
  const b = batches.find((x) => match(x, f));
  if (!b) return null;
  applyUpdate(b, u);
  return { ...b };
};
(BrainImportBatch as any).updateOne = async (f: Doc, u: Doc) => {
  await tick();
  const b = batches.find((x) => match(x, f));
  if (!b) return { modifiedCount: 0 };
  applyUpdate(b, u);
  return { modifiedCount: 1 };
};

const cat = new mongoose.Types.ObjectId().toString();
const user = new mongoose.Types.ObjectId().toString();
const csv = (v: string) => ({ "cases.csv": `a,b,v\nk1,1,${v}\nk2,1,${v}\n` });
const dry = async (v: string): Promise<string> =>
  (await svc.dryRunImport({ categoryId: cat, datasetKey: "t1", files: csv(v), userId: user })).importId;
const commit = (id: string) => svc.commitImport({ importId: id, acknowledgeWarnings: false, userId: user });
const statusOf = (id: string): string => batches.find((b) => same(b._id, id))!.status;
const reset = (): void => {
  recs = [];
  batches = [];
  failNext = null;
};
const state = (): string[] =>
  recs.map((r) => `${r.primaryKeyValue}:r${r.revision}:${r.status}`).sort();
const activeCount = (pk: string): number => recs.filter((r) => r.primaryKeyValue === pk && r.status === "active").length;
const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return "OK";
  } catch (e) {
    const x = e as { statusCode?: number; code?: string };
    return `${x.statusCode}${x.code ? ":" + x.code : ""}`;
  }
};

const main = async (): Promise<void> => {
  // 1. double commit of the same batch: exactly one wins, records survive
  reset();
  const b1 = await dry("one");
  await commit(b1);
  const b2 = await dry("two");
  const results = await Promise.all([code(commit(b2)), code(commit(b2))]);
  assert(results.filter((r) => r === "OK").length === 1, `exactly one commit succeeds: ${results}`);
  assert(results.some((r) => r.startsWith("409")), `loser gets 409: ${results}`);
  assert(statusOf(b2) === "committed", "batch committed");
  assert(activeCount("k1|1") === 1 && activeCount("k2|1") === 1, "one active record per key");
  assert(recs.filter((r) => String(r.importBatchId) === b2 && r.status === "active").length === 2, "winner's records kept");
  console.log("ok - double commit keeps the winner's records");

  // 2. rollback chain: B1,B2,B3; roll back B2 then B3 => B1 active again
  reset();
  const ids: string[] = [];
  for (const v of ["one", "two", "three"]) {
    const id = await dry(v);
    await commit(id);
    ids.push(id);
  }
  await svc.rollbackImport(ids[1], user);
  assert(activeCount("k1|1") === 1 && recs.some((r) => r.primaryKeyValue === "k1|1" && r.revision === 3 && r.status === "active"), "rolling back B2 while B3 active keeps r3 active");
  await svc.rollbackImport(ids[2], user);
  assert(recs.some((r) => r.primaryKeyValue === "k1|1" && r.revision === 1 && r.status === "active"), "B1 restored after B2 and B3 rolled back");
  assert(activeCount("k2|1") === 1, "k2 restored too");
  assert(statusOf(ids[2]) === "rolled_back", "batch rolled_back");
  console.log("ok - rollback chain restores the highest still-committed revision");

  // 3. concurrent rollback: one wins, other 409
  reset();
  const c1 = await dry("one");
  await commit(c1);
  const c2 = await dry("two");
  await commit(c2);
  const rb = await Promise.all([code(svc.rollbackImport(c2, user)), code(svc.rollbackImport(c2, user))]);
  assert(rb.filter((r) => r === "OK").length === 1 && rb.some((r) => r.startsWith("409")), `one rollback wins: ${rb}`);
  assert(activeCount("k1|1") === 1 && recs.find((r) => r.primaryKeyValue === "k1|1" && r.status === "active")!.revision === 1, "r1 active");
  console.log("ok - concurrent rollbacks: one wins");

  // 4. revision numbers are not reused after a rollback (unique index)
  const c3 = await dry("three");
  const r3 = await commit(c3);
  assert(r3.committed === 2 && recs.some((r) => r.primaryKeyValue === "k1|1" && r.revision === 3 && r.status === "active"), "re-import after rollback uses revision 3");
  console.log("ok - re-import after rollback gets a fresh revision");

  // 5. step 2 failure: superseded restored, inserts removed, claim reverted, retry works
  reset();
  const d1 = await dry("one");
  await commit(d1);
  const before = state();
  const d2 = await dry("two");
  failNext = { op: "updateMany", times: 1 };
  assert((await code(commit(d2))) === "500", "generic 500 on failure");
  assert(JSON.stringify(state()) === JSON.stringify(before), `state restored: ${state()}`);
  assert(statusOf(d2) === "dry_run" && batches.find((b) => same(b._id, d2))!.expiresAt && Object.keys(batches.find((b) => same(b._id, d2))!.files).length === 1, "batch back to dry_run with files and expiry");
  assert((await code(commit(d2))) === "OK", "retry succeeds");
  console.log("ok - failure after inserts cleans up and reverts the claim");

  // 6. rival batches racing on the same keys: one conflicts cleanly (409), state stays consistent
  reset();
  const e1 = await dry("one");
  await commit(e1);
  const eA = await dry("A");
  const eB = await dry("B");
  const race = await Promise.all([code(commit(eA)), code(commit(eB))]);
  assert(race.filter((r) => r === "OK").length === 1, `one rival wins: ${race}`);
  assert(race.some((r) => r === "409:COMMIT_CONFLICT"), `loser gets COMMIT_CONFLICT: ${race}`);
  assert(activeCount("k1|1") === 1 && activeCount("k2|1") === 1, "exactly one active record per key");
  assert(recs.filter((r) => r.status === "superseded").length === 2, "only the winner superseded r1");
  assert([eA, eB].filter((id) => statusOf(id) === "dry_run").length === 1, "loser reverted to dry_run");
  console.log("ok - rival commits conflict cleanly");

  // 7. committing an expired/unknown batch
  reset();
  const x1 = await dry("one");
  batches[0].expiresAt = new Date(Date.now() - 1000);
  assert((await code(commit(x1))) === "404", "expired => 404");
  assert((await code(commit(new mongoose.Types.ObjectId().toString()))) === "404", "unknown => 404");
  console.log("ok - expired and unknown batches are 404");

  console.log("datasetsCommit fixtures passed");
};

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
