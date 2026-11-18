import crypto from "crypto";
import mongoose from "mongoose";
import { z } from "zod";
import FileBank from "../../models/FileBank.model";
import {
  BrainDatasetDefinitionRecord,
  BrainDatasetRecord,
  BrainImportBatch,
} from "../../models/BrainKnowledge.model";
import logger from "../../utils/logger";
import { checks, getSourceLine, validateDataset } from "./datasetValidator";
import { fileBankVisibilityFilter } from "./fileBankAccess";
import { scheduleBatchEmbedding } from "./indexer.service";
import { buildRecordCards, primaryKeyValueOf } from "./recordCards";
import { rodPumpFailureDefinition } from "./definitions/rodPumpFailure";
import { ColumnType, DatasetDefinition, ImportReport, RowIssue, TableDef } from "./types";

export const MAX_IMPORT_BYTES = 12 * 1024 * 1024;
export const DRY_RUN_TTL_MS = 24 * 60 * 60 * 1000;
const INSERT_CHUNK = 1000;

export const builtinDefinitions: DatasetDefinition[] = [rodPumpFailureDefinition];

/** HTTP-aware error. Messages are safe to return (never contain row values). */
export class DatasetHttpError extends Error {
  statusCode: number;
  code?: string;
  constructor(statusCode: number, message: string, code?: string) {
    super(message);
    this.name = "DatasetHttpError";
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, DatasetHttpError.prototype);
  }
}

export type PublicReport = Omit<ImportReport, "rows"> & { truncated?: boolean; issueTotal: number };

// ---------------------------------------------------------------- pure helpers

export const totalImportBytes = (files: Record<string, string>): number =>
  Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0);

/** Typed so the service can answer 422 instead of 500. */
export class DuplicatePrimaryKeyError extends Error {
  constructor() {
    super("Duplicate primary keys in incoming rows");
    this.name = "DuplicatePrimaryKeyError";
    Object.setPrototypeOf(this, DuplicatePrimaryKeyError.prototype);
  }
}

/**
 * `existing` lists the highest known revision per pk. `active: false` marks history with no active record
 * (superseded/rolled back only): the next revision is still max+1 (revision numbers are never reused, which
 * the unique index requires) but there is nothing to supersede.
 */
export const planRevisions = (
  existing: { pk: string; revision: number; active?: boolean }[],
  incomingPks: string[],
): { pk: string; revision: number; supersedes?: string }[] => {
  if (new Set(incomingPks).size !== incomingPks.length) throw new DuplicatePrimaryKeyError();
  const current = new Map(existing.map((e) => [e.pk, e]));
  return incomingPks.map((pk) => {
    const prev = current.get(pk);
    if (!prev) return { pk, revision: 1 };
    return prev.active === false ? { pk, revision: prev.revision + 1 } : { pk, revision: prev.revision + 1, supersedes: pk };
  });
};

/**
 * Rollback: for each pk with no active record left, restore its highest-revision `superseded` record.
 * Records of rolled-back batches carry status `rolled_back` and are never candidates.
 */
export const selectRestoreCandidates = (
  records: { pk: string; revision: number; status: string }[],
): { pk: string; revision: number }[] => {
  const byPk = new Map<string, { pk: string; revision: number; status: string }[]>();
  for (const r of records) {
    if (!byPk.has(r.pk)) byPk.set(r.pk, []);
    byPk.get(r.pk)!.push(r);
  }
  const out: { pk: string; revision: number }[] = [];
  for (const [pk, list] of byPk) {
    if (list.some((r) => r.status === "active")) continue;
    const sup = list.filter((r) => r.status === "superseded");
    if (!sup.length) continue;
    out.push({ pk, revision: Math.max(...sup.map((r) => r.revision)) });
  }
  return out;
};

export const MAX_REPORT_ISSUES = 1000;

/** Keeps stored/returned reports small: first N issues plus the true total. */
export const capReportIssues = <T extends { issues: RowIssue[] }>(
  report: T,
  max = MAX_REPORT_ISSUES,
): T & { truncated?: boolean; issueTotal: number } => {
  const total = report.issues.length;
  if (total <= max) return { ...report, issueTotal: total };
  return { ...report, issues: report.issues.slice(0, max), issueTotal: total, truncated: true };
};

const EVIDENCE_FILE = "evidence.csv";

/** Contract A5: resolve evidence `file_name` values against File Bank original-name counts. */
export const resolveFileIssues = (
  evidenceRows: { rowNumber: number; file_name: string }[],
  fileBankNames: Map<string, number>,
): RowIssue[] => {
  const issues: RowIssue[] = [];
  for (const r of evidenceRows) {
    const n = fileBankNames.get(r.file_name) ?? 0;
    if (n === 1) continue;
    if (n === 0) {
      issues.push({
        file: EVIDENCE_FILE,
        row: r.rowNumber,
        column: "file_name",
        severity: "warn",
        code: "FILE_NOT_FOUND",
        message: "file_name does not match any File Bank file; the row is kept without a linked file",
      });
    } else {
      issues.push({
        file: EVIDENCE_FILE,
        row: r.rowNumber,
        column: "file_name",
        severity: "reject",
        code: "AMBIGUOUS_FILE",
        message: "file_name matches more than one File Bank file",
      });
    }
  }
  return issues;
};

export const decideCommit = (
  report: { canCommit: boolean; issues: { severity: string }[] },
  acknowledgeWarnings: boolean,
): "ok" | "has_rejects" | "needs_ack" => {
  if (!report.canCommit || report.issues.some((i) => i.severity === "reject")) return "has_rejects";
  if (report.issues.some((i) => i.severity === "warn") && !acknowledgeWarnings) return "needs_ack";
  return "ok";
};

const COLUMN_TYPES: [ColumnType, ...ColumnType[]] = [
  "string", "text", "integer", "number", "boolean", "date", "enum", "enum_list", "percent",
];

const NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const FILE_RE = /^[a-z][a-z0-9_]{0,63}\.csv$/;
const FORBIDDEN_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const safeName = z.string().regex(NAME_RE).refine((n) => !FORBIDDEN_NAMES.has(n), "reserved name");
const CHECK_IDS = Object.keys(checks) as [string, ...string[]];

const columnSchema = z.object({
  name: safeName,
  type: z.enum(COLUMN_TYPES),
  required: z.boolean().optional(),
  maxLength: z.number().int().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  values: z.array(z.string().min(1).max(100)).max(200).optional(),
  notFuture: z.boolean().optional(),
});

const tableSchema = z.object({
  name: safeName,
  file: z.string().regex(FILE_RE).refine((f) => f !== "README.txt", "reserved file name"),
  required: z.boolean(),
  primaryKey: z.array(z.string()).min(1).max(8),
  columns: z.array(columnSchema).min(1).max(100),
  references: z.array(z.object({ column: z.string(), table: z.string(), refColumn: z.string() })).max(20),
  checks: z.array(z.enum(CHECK_IDS)).max(20),
});

const definitionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  version: z.string().min(1).max(40),
  label: z.string().min(1).max(160),
  tables: z.array(tableSchema).min(1).max(20),
  card: z.object({ rootTable: z.string(), include: z.array(z.string()).max(20) }).optional(),
});

/** Parses (stripping unknown keys) and checks cross-references. Persist `def`, never the raw body. */
export const parseDefinition = (
  input: unknown,
): { ok: true; def: DatasetDefinition } | { ok: false; errors: string[] } => {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const d = parsed.data;
  const errors: string[] = [];
  const tables = new Map<string, TableDef>();
  const files = new Set<string>();
  for (const t of d.tables as TableDef[]) {
    if (tables.has(t.name)) errors.push(`table ${t.name}: duplicate table name`);
    tables.set(t.name, t);
    if (files.has(t.file)) errors.push(`table ${t.name}: duplicate file name`);
    files.add(t.file);
  }
  for (const t of d.tables as TableDef[]) {
    const cols = new Set<string>();
    for (const c of t.columns) {
      if (cols.has(c.name)) errors.push(`table ${t.name}: duplicate column ${c.name}`);
      cols.add(c.name);
      if ((c.type === "enum" || c.type === "enum_list") && !(c.values && c.values.length > 0)) {
        errors.push(`table ${t.name}: column ${c.name} needs values`);
      }
    }
    for (const k of t.primaryKey) {
      if (!cols.has(k)) errors.push(`table ${t.name}: primary key column ${k} does not exist`);
    }
    for (const r of t.references) {
      if (!cols.has(r.column)) errors.push(`table ${t.name}: reference column ${r.column} does not exist`);
      const target = tables.get(r.table);
      if (!target) errors.push(`table ${t.name}: reference table ${r.table} does not exist`);
      else if (!target.columns.some((c) => c.name === r.refColumn)) {
        errors.push(`table ${t.name}: reference target ${r.table}.${r.refColumn} does not exist`);
      }
    }
  }
  if (d.card) {
    if (!tables.has(d.card.rootTable)) errors.push(`card: root table ${d.card.rootTable} does not exist`);
    for (const inc of d.card.include) {
      if (!tables.has(inc)) errors.push(`card: included table ${inc} does not exist`);
    }
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };
  return { ok: true, def: d as DatasetDefinition };
};

/** Returns the list of failed rules (empty when valid). Never echoes the body. */
export const validateDefinitionShape = (def: unknown): string[] => {
  const r = parseDefinition(def);
  return r.ok ? [] : r.errors;
};

/** Blank CSV header files for every table plus a README describing the columns. */
export const buildTemplateFiles = (def: DatasetDefinition): Record<string, string> => {
  const out: Record<string, string> = {};
  const readme: string[] = [
    `${def.label} (${def.key}, version ${def.version})`,
    "",
    "Fill in one CSV file per table below. Keep the header row exactly as provided.",
    "Use UTF-8. Leave a cell empty instead of writing N/A, - or null. Dates are YYYY-MM-DD.",
    "Lists (enum_list) are separated by semicolons.",
    "",
  ];
  for (const t of def.tables) {
    out[t.file] = `${t.columns.map((c) => c.name).join(",")}\n`;
    readme.push(`${t.file} (table ${t.name}, ${t.required ? "required" : "optional"})`);
    readme.push(`  Primary key: ${t.primaryKey.join(" + ")}`);
    for (const c of t.columns) {
      const bits = [c.type, c.required ? "required" : "optional"];
      if (c.maxLength !== undefined) bits.push(`max length ${c.maxLength}`);
      if (c.min !== undefined) bits.push(`min ${c.min}`);
      if (c.max !== undefined) bits.push(`max ${c.max}`);
      if (c.notFuture) bits.push("not in the future");
      readme.push(`  - ${c.name}: ${bits.join(", ")}`);
      if (c.values?.length) readme.push(`      allowed values: ${c.values.join(", ")}`);
    }
    for (const r of t.references) readme.push(`  ${r.column} must match ${r.table}.${r.refColumn}`);
    readme.push("");
  }
  out["README.txt"] = readme.join("\n");
  return out;
};

// ------------------------------------------------------------ definition registry

export const registerDefinition = async (categoryId: string, def: DatasetDefinition, userId: string): Promise<void> => {
  const parsed = parseDefinition(def);
  if (!parsed.ok) throw new DatasetHttpError(422, `Invalid dataset definition: ${parsed.errors.join("; ")}`, "INVALID_DEFINITION");
  const clean = parsed.def; // persist the parsed definition, never the raw body
  await BrainDatasetDefinitionRecord.updateOne(
    { categoryId: new mongoose.Types.ObjectId(categoryId), key: clean.key },
    { $set: { version: clean.version, definition: clean, updatedBy: new mongoose.Types.ObjectId(userId) } },
    { upsert: true },
  );
};

/** Registered definition for the category, else a built-in (auto-registered when userId is given). */
const loadDefinition = async (categoryId: string, key: string, autoRegisterBy?: string): Promise<DatasetDefinition> => {
  const rec = await BrainDatasetDefinitionRecord.findOne({ categoryId: new mongoose.Types.ObjectId(categoryId), key }).lean();
  if (rec) {
    const errors = validateDefinitionShape(rec.definition);
    if (errors.length) throw new DatasetHttpError(422, "Stored dataset definition is invalid", "INVALID_DEFINITION");
    return rec.definition as DatasetDefinition;
  }
  const builtin = builtinDefinitions.find((d) => d.key === key);
  if (!builtin) throw new DatasetHttpError(404, "Dataset definition not found");
  if (autoRegisterBy) await registerDefinition(categoryId, builtin, autoRegisterBy);
  return builtin;
};

export const getDefinitionForCategory = (categoryId: string, key: string): Promise<DatasetDefinition> =>
  loadDefinition(categoryId, key);

// ------------------------------------------------------------ evidence file names

const evidenceTable = (def: DatasetDefinition): TableDef | undefined =>
  def.tables.find((t) => t.name === "evidence" && t.columns.some((c) => c.name === "file_name"));

const loadFileBankNameCounts = async (names: string[]): Promise<Map<string, number>> => {
  const counts = new Map<string, number>();
  if (!names.length) return counts;
  const groups = await FileBank.aggregate<{ _id: string; n: number }>([
    { $match: { originalName: { $in: names }, ...fileBankVisibilityFilter(undefined) } },
    { $group: { _id: "$originalName", n: { $sum: 1 } } },
  ]);
  for (const g of groups) counts.set(g._id, g.n);
  return counts;
};

/** Validates and applies File Bank name resolution (contract A5). Mutates and returns the report. */
const validateWithFiles = async (def: DatasetDefinition, files: Record<string, string>): Promise<ImportReport> => {
  const report = validateDataset(def, files);
  const ev = evidenceTable(def);
  if (!ev) return report;
  const rows = report.rows[ev.name] ?? [];
  if (!rows.length) return report;
  const names = [...new Set(rows.map((r) => String(r.file_name ?? "")).filter(Boolean))];
  const counts = await loadFileBankNameCounts(names);
  const evidenceRows = rows
    .filter((r) => typeof r.file_name === "string" && r.file_name !== "")
    .map((r) => ({ rowNumber: getSourceLine(r) ?? 0, file_name: r.file_name as string }));
  const issues = resolveFileIssues(evidenceRows, counts);
  report.issues.push(...issues);
  for (const r of rows) r.fileLinked = counts.get(String(r.file_name ?? "")) === 1;
  const ambiguous = issues.filter((i) => i.code === "AMBIGUOUS_FILE").length;
  if (ambiguous) {
    report.canCommit = false;
    const f = report.files[ev.file];
    if (f) {
      f.rowsAccepted = Math.max(0, f.rowsAccepted - ambiguous);
      f.rowsRejected += ambiguous;
    }
  }
  return report;
};

const publicReport = (report: ImportReport): PublicReport => {
  const { rows: _rows, ...rest } = report;
  return capReportIssues(rest);
};

// ------------------------------------------------------------------- dry run

export const dryRunImport = async (p: {
  categoryId: string;
  datasetKey: string;
  files: Record<string, string>;
  userId: string;
}): Promise<{ importId: string; report: PublicReport }> => {
  if (totalImportBytes(p.files) > MAX_IMPORT_BYTES) {
    throw new DatasetHttpError(413, "Import exceeds the 12 MB limit.", "IMPORT_TOO_LARGE");
  }
  const def = await loadDefinition(p.categoryId, p.datasetKey, p.userId);
  const known = new Set(def.tables.map((t) => t.file));
  if (Object.keys(p.files).some((f) => !known.has(f))) {
    throw new DatasetHttpError(422, "Unknown file name for this dataset.", "UNKNOWN_FILE");
  }
  const report = await validateWithFiles(def, p.files);
  const slim = publicReport(report); // rows are never persisted or returned from a dry run
  const fileHashes = Object.fromEntries(
    Object.entries(p.files).map(([name, text]) => [name, crypto.createHash("sha256").update(text).digest("hex")]),
  );
  const batch = await BrainImportBatch.create({
    categoryId: new mongoose.Types.ObjectId(p.categoryId),
    datasetKey: def.key,
    datasetVersion: def.version,
    status: "dry_run",
    report: slim,
    files: p.files,
    fileHashes,
    embeddingStatus: "none",
    createdBy: new mongoose.Types.ObjectId(p.userId),
    expiresAt: new Date(Date.now() + DRY_RUN_TTL_MS),
  });
  return { importId: String(batch._id), report: slim };
};

// -------------------------------------------------------------------- commit

type NewRecord = {
  categoryId: mongoose.Types.ObjectId;
  datasetKey: string;
  table: string;
  primaryKeyValue: string;
  data: Record<string, unknown>;
  cardText?: string;
  importBatchId: mongoose.Types.ObjectId;
  revision: number;
  status: "active";
};

const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

const isDuplicateKeyError = (e: unknown): boolean => {
  const err = e as { code?: number; writeErrors?: { code?: number }[]; errorResponse?: { code?: number } };
  return err?.code === 11000 || err?.errorResponse?.code === 11000 || !!err?.writeErrors?.some((w) => w.code === 11000);
};

/**
 * Commit protocol. Mongo is not assumed transactional, so:
 *   0. CLAIM: atomically dry_run -> committing (conditional on status and not expired). Only the request that
 *      wins the claim writes anything; a second request gets 409/404 and touches nothing.
 *   1. insert the new records as "active" (tagged importBatchId). The unique index on
 *      (category, dataset, table, pk, revision) makes a rival batch committing the same key fail cleanly.
 *   2. mark the previously active revisions "superseded" (ids read before step 1; idempotent).
 *   3. FLIP: committing -> committed (conditional), clear raw files and the TTL.
 * On ANY failure after the claim: if step 2 had started, the superseded ids go back to "active" (only then, so a
 * rival's supersede is never undone); this batch's inserts are deleted by importBatchId; the batch reverts to
 * dry_run with files/expiresAt untouched; then a generic 500 (409 COMMIT_CONFLICT on a duplicate-key error).
 * Cleanup is best effort and never logs or returns content. A process crash between claim and flip leaves the
 * batch in "committing" (its TTL still expires it).
 */
export const commitImport = async (p: {
  importId: string;
  acknowledgeWarnings: boolean;
  userId: string;
}): Promise<{ committed: number; revisions: number; categoryId: string; issues: number }> => {
  if (!mongoose.isValidObjectId(p.importId)) throw new DatasetHttpError(404, "Import not found");
  const batch = await BrainImportBatch.findOneAndUpdate(
    { _id: p.importId, status: "dry_run", expiresAt: { $gt: new Date() } },
    { $set: { status: "committing" } },
    { new: true },
  );
  if (!batch) {
    const existing = await BrainImportBatch.findById(p.importId);
    if (!existing || (existing.status === "dry_run")) throw new DatasetHttpError(404, "Import not found");
    throw new DatasetHttpError(409, "This import was already committed or is being committed.", "IMPORT_NOT_COMMITTABLE");
  }
  const batchId = batch._id as mongoose.Types.ObjectId;
  const catOid = batch.categoryId as mongoose.Types.ObjectId;
  const categoryId = String(catOid);
  const revertClaim = async (): Promise<void> => {
    try {
      await BrainImportBatch.updateOne({ _id: batchId, status: "committing" }, { $set: { status: "dry_run" } });
    } catch {
      logger.error(`Brain import claim revert failed for batch ${String(batchId)}`);
    }
  };

  const toInsert: NewRecord[] = [];
  const supersededIds: mongoose.Types.ObjectId[] = [];
  let revisions = 0;
  let issueCount = 0;
  let step2Started = false;

  try {
    const def = await loadDefinition(categoryId, batch.datasetKey);
    const report = await validateWithFiles(def, (batch.files ?? {}) as Record<string, string>);
    issueCount = report.issues.length;
    const decision = decideCommit(report, p.acknowledgeWarnings);
    if (decision === "has_rejects") throw new DatasetHttpError(422, "The import has rejected rows and cannot be committed.", "IMPORT_HAS_REJECTS");
    if (decision === "needs_ack") throw new DatasetHttpError(422, "Warnings must be acknowledged before committing.", "WARNINGS_NOT_ACKNOWLEDGED");

    const cards = new Map(buildRecordCards(def, report.rows).map((c) => [c.primaryKeyValue, c.text]));
    const rootName = def.card?.rootTable;

    // Reads only: plan revisions per table (max revision over ALL statuses; only active ones are superseded).
    for (const table of def.tables) {
      const rows = report.rows[table.name] ?? [];
      if (!rows.length) continue;
      const pks = rows.map((r) => primaryKeyValueOf(table, r));
      const known = new Map<string, { pk: string; revision: number; active: boolean }>();
      for (const part of chunk(pks, INSERT_CHUNK)) {
        const docs = await BrainDatasetRecord.find({
          categoryId: catOid,
          datasetKey: def.key,
          table: table.name,
          primaryKeyValue: { $in: part },
        })
          .select("primaryKeyValue revision status")
          .lean();
        for (const d of docs) {
          const cur = known.get(d.primaryKeyValue) ?? { pk: d.primaryKeyValue, revision: 0, active: false };
          cur.revision = Math.max(cur.revision, d.revision);
          if (d.status === "active") {
            cur.active = true;
            supersededIds.push(d._id as mongoose.Types.ObjectId);
          }
          known.set(d.primaryKeyValue, cur);
        }
      }
      const plan = planRevisions([...known.values()], pks);
      revisions += plan.filter((x) => x.supersedes).length;
      rows.forEach((row, i) => {
        toInsert.push({
          categoryId: catOid,
          datasetKey: def.key,
          table: table.name,
          primaryKeyValue: plan[i].pk,
          data: row,
          ...(table.name === rootName && cards.has(plan[i].pk) ? { cardText: cards.get(plan[i].pk) } : {}),
          importBatchId: batchId,
          revision: plan[i].revision,
          status: "active",
        });
      });
    }

    for (const part of chunk(toInsert, INSERT_CHUNK)) await BrainDatasetRecord.insertMany(part); // step 1
    step2Started = true;
    for (const part of chunk(supersededIds, INSERT_CHUNK)) {
      await BrainDatasetRecord.updateMany({ _id: { $in: part }, status: "active" }, { $set: { status: "superseded" } }); // step 2
    }
    const res = await BrainImportBatch.updateOne(
      { _id: batchId, status: "committing" },
      {
        $set: {
          status: "committed",
          committedBy: new mongoose.Types.ObjectId(p.userId),
          committedAt: new Date(),
          files: {},
          embeddingStatus: "pending",
        },
        $unset: { expiresAt: "" },
      },
    ); // step 3
    if (res.modifiedCount !== 1) throw new Error("batch state changed during commit");
  } catch (error) {
    if (toInsert.length || step2Started) {
      try {
        if (step2Started) {
          for (const part of chunk(supersededIds, INSERT_CHUNK)) {
            await BrainDatasetRecord.updateMany({ _id: { $in: part }, status: "superseded" }, { $set: { status: "active" } });
          }
        }
        await BrainDatasetRecord.deleteMany({ importBatchId: batchId });
      } catch {
        logger.error(`Brain import cleanup failed for batch ${String(batchId)}`);
      }
    }
    await revertClaim();
    if (error instanceof DatasetHttpError) throw error;
    if (error instanceof DuplicatePrimaryKeyError) {
      throw new DatasetHttpError(422, "The import contains duplicate primary keys.", "DUPLICATE_PRIMARY_KEY");
    }
    if (isDuplicateKeyError(error)) {
      throw new DatasetHttpError(409, "Another import changed the same records; retry the commit.", "COMMIT_CONFLICT");
    }
    logger.error(`Brain import commit failed for batch ${String(batchId)}`);
    throw new DatasetHttpError(500, "Internal server error");
  }

  scheduleBatchEmbedding(String(batchId));
  return { committed: toInsert.length, revisions, categoryId, issues: issueCount };
};

// ------------------------------------------------------------------ rollback

/**
 * Rollback protocol: claim committed -> rolling_back (conditional, so concurrent rollbacks cannot both run),
 * mark this batch's records rolled_back, restore per key the highest superseded revision when no active record
 * remains (selectRestoreCandidates), then rolling_back -> rolled_back. Every step is idempotent; on failure the
 * batch reverts to committed so the rollback can simply be retried. Restoring revisions never touches records of
 * other rolled-back batches (their status is rolled_back).
 * Note for Task 13: root `cardText` is built from THIS batch's rows only, so the embedding step must rebuild each
 * root card from the ACTIVE records of the root row and its child tables.
 */
export const rollbackImport = async (
  importId: string,
  _userId: string,
): Promise<{ categoryId: string; rolledBack: number; restored: number }> => {
  if (!mongoose.isValidObjectId(importId)) throw new DatasetHttpError(404, "Import not found");
  const batch = await BrainImportBatch.findOneAndUpdate(
    { _id: importId, status: "committed" },
    { $set: { status: "rolling_back" } },
    { new: true },
  );
  if (!batch) {
    const existing = await BrainImportBatch.findById(importId);
    if (!existing) throw new DatasetHttpError(404, "Import not found");
    throw new DatasetHttpError(409, "Only a committed import can be rolled back.");
  }
  const batchId = batch._id as mongoose.Types.ObjectId;
  const catOid = batch.categoryId as mongoose.Types.ObjectId;
  try {
    const mine = await BrainDatasetRecord.find({ importBatchId: batchId }).select("table primaryKeyValue").lean();
    await BrainDatasetRecord.updateMany({ importBatchId: batchId }, { $set: { status: "rolled_back" } });

    const pksByTable = new Map<string, Set<string>>();
    for (const r of mine) {
      if (!pksByTable.has(r.table)) pksByTable.set(r.table, new Set());
      pksByTable.get(r.table)!.add(r.primaryKeyValue);
    }
    let restored = 0;
    for (const [table, set] of pksByTable) {
      for (const part of chunk([...set], INSERT_CHUNK)) {
        const docs = await BrainDatasetRecord.find({
          categoryId: catOid,
          datasetKey: batch.datasetKey,
          table,
          primaryKeyValue: { $in: part },
        })
          .select("primaryKeyValue revision status")
          .lean();
        const chosen = selectRestoreCandidates(
          docs.map((d) => ({ pk: d.primaryKeyValue, revision: d.revision, status: d.status })),
        );
        const want = new Set(chosen.map((c) => `${c.pk}\u0000${c.revision}`));
        const ids = docs
          .filter((d) => d.status === "superseded" && want.has(`${d.primaryKeyValue}\u0000${d.revision}`))
          .map((d) => d._id);
        if (ids.length) {
          await BrainDatasetRecord.updateMany({ _id: { $in: ids }, status: "superseded" }, { $set: { status: "active" } });
          restored += ids.length;
        }
      }
    }
    const res = await BrainImportBatch.updateOne({ _id: batchId, status: "rolling_back" }, { $set: { status: "rolled_back" } });
    if (res.modifiedCount !== 1) throw new Error("batch state changed during rollback");
    return { categoryId: String(catOid), rolledBack: mine.length, restored };
  } catch {
    try {
      await BrainImportBatch.updateOne({ _id: batchId, status: "rolling_back" }, { $set: { status: "committed" } });
    } catch {
      logger.error(`Brain import rollback revert failed for batch ${String(batchId)}`);
    }
    logger.error(`Brain import rollback failed for batch ${String(batchId)}`);
    throw new DatasetHttpError(500, "Internal server error");
  }
};

// ------------------------------------------------------------------- browse

export const listRecords = async (p: {
  categoryId: string;
  datasetKey: string;
  table: string;
  page: number;
  pageSize: number;
}): Promise<{ items: Record<string, unknown>[]; total: number }> => {
  const def = await loadDefinition(p.categoryId, p.datasetKey);
  if (!def.tables.some((t) => t.name === p.table)) throw new DatasetHttpError(404, "Table not found");
  const page = Math.max(1, Math.floor(p.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Math.floor(p.pageSize) || 50));
  const filter = {
    categoryId: new mongoose.Types.ObjectId(p.categoryId),
    datasetKey: p.datasetKey,
    table: p.table,
    status: "active",
  };
  const [docs, total] = await Promise.all([
    BrainDatasetRecord.find(filter)
      .select("data primaryKeyValue revision") // never cardText or embedding
      .sort({ primaryKeyValue: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    BrainDatasetRecord.countDocuments(filter),
  ]);
  return {
    items: docs.map((d) => ({ ...(d.data as Record<string, unknown>), primaryKeyValue: d.primaryKeyValue, revision: d.revision })),
    total,
  };
};
