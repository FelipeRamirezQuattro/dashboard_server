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
import { getSourceLine, validateDataset } from "./datasetValidator";
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

export type PublicReport = Omit<ImportReport, "rows">;

// ---------------------------------------------------------------- pure helpers

export const totalImportBytes = (files: Record<string, string>): number =>
  Object.values(files).reduce((sum, text) => sum + Buffer.byteLength(text, "utf8"), 0);

export const planRevisions = (
  existing: { pk: string; revision: number }[],
  incomingPks: string[],
): { pk: string; revision: number; supersedes?: string }[] => {
  if (new Set(incomingPks).size !== incomingPks.length) throw new Error("Duplicate primary keys in incoming rows");
  const current = new Map(existing.map((e) => [e.pk, e.revision]));
  return incomingPks.map((pk) => {
    const prev = current.get(pk);
    return prev === undefined ? { pk, revision: 1 } : { pk, revision: prev + 1, supersedes: pk };
  });
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

const columnSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(COLUMN_TYPES),
  required: z.boolean().optional(),
  maxLength: z.number().int().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  values: z.array(z.string().min(1).max(120)).max(500).optional(),
  notFuture: z.boolean().optional(),
});

const tableSchema = z.object({
  name: z.string().min(1).max(80),
  file: z.string().min(1).max(120),
  required: z.boolean(),
  primaryKey: z.array(z.string()).min(1).max(8),
  columns: z.array(columnSchema).min(1).max(100),
  references: z.array(z.object({ column: z.string(), table: z.string(), refColumn: z.string() })).max(20),
  checks: z.array(z.string().max(80)).max(20),
});

const definitionSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  version: z.string().min(1).max(40),
  label: z.string().min(1).max(160),
  tables: z.array(tableSchema).min(1).max(20),
  card: z.object({ rootTable: z.string(), include: z.array(z.string()).max(20) }).optional(),
});

/** Returns the list of failed rules (empty when valid). Never echoes the body. */
export const validateDefinitionShape = (def: unknown): string[] => {
  const parsed = definitionSchema.safeParse(def);
  if (!parsed.success) {
    return parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
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
  return errors.slice(0, 20);
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
  const errors = validateDefinitionShape(def);
  if (errors.length) throw new DatasetHttpError(422, `Invalid dataset definition: ${errors.join("; ")}`, "INVALID_DEFINITION");
  await BrainDatasetDefinitionRecord.updateOne(
    { categoryId: new mongoose.Types.ObjectId(categoryId), key: def.key },
    { $set: { version: def.version, definition: def, updatedBy: new mongoose.Types.ObjectId(userId) } },
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
  return rest;
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

/**
 * Commit writes, in this order (Mongo is not assumed transactional, so every step is safe to re-run):
 *   1. insert the new records as "active" (tagged with importBatchId)
 *   2. mark the previously active revisions "superseded"
 *   3. flip the batch to "committed" (and clear raw files / TTL)
 * If any step throws after the inserts started, cleanup restores the previous revisions to "active"
 * (by the ids read before step 1) and deletes every record carrying this importBatchId, then a
 * generic 500 is raised. Cleanup is best effort and never includes content in logs or errors.
 */
export const commitImport = async (p: {
  importId: string;
  acknowledgeWarnings: boolean;
  userId: string;
}): Promise<{ committed: number; revisions: number; categoryId: string; issues: number }> => {
  const notFound = new DatasetHttpError(404, "Import not found");
  if (!mongoose.isValidObjectId(p.importId)) throw notFound;
  const batch = await BrainImportBatch.findById(p.importId);
  if (!batch || batch.status !== "dry_run" || !batch.expiresAt || batch.expiresAt.getTime() <= Date.now()) throw notFound;
  const categoryId = String(batch.categoryId);
  const def = await loadDefinition(categoryId, batch.datasetKey);
  const report = await validateWithFiles(def, (batch.files ?? {}) as Record<string, string>);
  const decision = decideCommit(report, p.acknowledgeWarnings);
  if (decision === "has_rejects") throw new DatasetHttpError(422, "The import has rejected rows and cannot be committed.", "IMPORT_HAS_REJECTS");
  if (decision === "needs_ack") throw new DatasetHttpError(422, "Warnings must be acknowledged before committing.", "WARNINGS_NOT_ACKNOWLEDGED");

  const batchId = batch._id as mongoose.Types.ObjectId;
  const catOid = batch.categoryId as mongoose.Types.ObjectId;
  const cards = new Map(buildRecordCards(def, report.rows).map((c) => [c.primaryKeyValue, c.text]));
  const rootName = def.card?.rootTable;

  const toInsert: NewRecord[] = [];
  const supersededIds: mongoose.Types.ObjectId[] = [];
  const supersededPks: { table: string; pks: string[] }[] = [];
  let revisions = 0;

  // Reads only: plan revisions per table.
  for (const table of def.tables) {
    const rows = report.rows[table.name] ?? [];
    if (!rows.length) continue;
    const pks = rows.map((r) => primaryKeyValueOf(table, r));
    const existingDocs: { _id: mongoose.Types.ObjectId; primaryKeyValue: string; revision: number }[] = [];
    for (const part of chunk(pks, INSERT_CHUNK)) {
      existingDocs.push(
        ...(await BrainDatasetRecord.find({
          categoryId: catOid,
          datasetKey: def.key,
          table: table.name,
          status: "active",
          primaryKeyValue: { $in: part },
        })
          .select("primaryKeyValue revision")
          .lean()),
      );
    }
    const plan = planRevisions(existingDocs.map((e) => ({ pk: e.primaryKeyValue, revision: e.revision })), pks);
    supersededIds.push(...existingDocs.map((e) => e._id));
    const sup = plan.filter((x) => x.supersedes).map((x) => x.pk);
    if (sup.length) supersededPks.push({ table: table.name, pks: sup });
    revisions += sup.length;
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

  try {
    // Step 1: insert new records.
    for (const part of chunk(toInsert, INSERT_CHUNK)) await BrainDatasetRecord.insertMany(part);
    // Step 2: supersede previous active revisions (ids read before step 1; idempotent).
    for (const part of chunk(supersededIds, INSERT_CHUNK)) {
      await BrainDatasetRecord.updateMany({ _id: { $in: part }, status: "active" }, { $set: { status: "superseded" } });
    }
    // Step 3: flip the batch.
    const res = await BrainImportBatch.updateOne(
      { _id: batchId, status: "dry_run" },
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
    );
    if (res.modifiedCount !== 1) throw new Error("batch state changed during commit");
  } catch {
    try {
      for (const part of chunk(supersededIds, INSERT_CHUNK)) {
        await BrainDatasetRecord.updateMany({ _id: { $in: part }, status: "superseded" }, { $set: { status: "active" } });
      }
      await BrainDatasetRecord.deleteMany({ importBatchId: batchId });
    } catch {
      logger.error(`Brain import cleanup failed for batch ${String(batchId)}`);
    }
    logger.error(`Brain import commit failed for batch ${String(batchId)}`);
    throw new DatasetHttpError(500, "Internal server error");
  }

  scheduleBatchEmbedding(String(batchId));
  return { committed: toInsert.length, revisions, categoryId, issues: report.issues.length };
};

// ------------------------------------------------------------------ rollback

export const rollbackImport = async (
  importId: string,
  _userId: string,
): Promise<{ categoryId: string; rolledBack: number; restored: number }> => {
  if (!mongoose.isValidObjectId(importId)) throw new DatasetHttpError(404, "Import not found");
  const batch = await BrainImportBatch.findById(importId);
  if (!batch) throw new DatasetHttpError(404, "Import not found");
  if (batch.status !== "committed") throw new DatasetHttpError(409, "Only a committed import can be rolled back.");
  const batchId = batch._id as mongoose.Types.ObjectId;
  const catOid = batch.categoryId as mongoose.Types.ObjectId;

  const mine = await BrainDatasetRecord.find({ importBatchId: batchId })
    .select("table primaryKeyValue revision")
    .lean();
  await BrainDatasetRecord.updateMany({ importBatchId: batchId }, { $set: { status: "rolled_back" } });

  // Restore what this batch superseded, unless a newer active revision exists for that key.
  const wantedByTable = new Map<string, Set<string>>();
  for (const r of mine) {
    if (r.revision <= 1) continue;
    if (!wantedByTable.has(r.table)) wantedByTable.set(r.table, new Set());
    wantedByTable.get(r.table)!.add(r.primaryKeyValue);
  }
  let restored = 0;
  for (const [table, set] of wantedByTable) {
    for (const part of chunk([...set], INSERT_CHUNK)) {
      const base = { categoryId: catOid, datasetKey: batch.datasetKey, table, primaryKeyValue: { $in: part } };
      const active = new Set(
        (await BrainDatasetRecord.find({ ...base, status: "active" }).select("primaryKeyValue").lean()).map((a) => a.primaryKeyValue),
      );
      const superseded = await BrainDatasetRecord.find({ ...base, status: "superseded", importBatchId: { $ne: batchId } })
        .select("primaryKeyValue revision updatedAt")
        .lean();
      const myRevision = new Map(mine.filter((m) => m.table === table).map((m) => [m.primaryKeyValue, m.revision]));
      const pick = new Map<string, { _id: mongoose.Types.ObjectId; updatedAt: Date }>();
      for (const s of superseded) {
        if (active.has(s.primaryKeyValue)) continue;
        if (s.revision !== (myRevision.get(s.primaryKeyValue) ?? 0) - 1) continue;
        const cur = pick.get(s.primaryKeyValue);
        if (!cur || s.updatedAt > cur.updatedAt) pick.set(s.primaryKeyValue, { _id: s._id, updatedAt: s.updatedAt });
      }
      const ids = [...pick.values()].map((v) => v._id);
      if (ids.length) {
        await BrainDatasetRecord.updateMany({ _id: { $in: ids } }, { $set: { status: "active" } });
        restored += ids.length;
      }
    }
  }
  await BrainImportBatch.updateOne({ _id: batchId, status: "committed" }, { $set: { status: "rolled_back" } });
  return { categoryId: String(catOid), rolledBack: mine.length, restored };
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
