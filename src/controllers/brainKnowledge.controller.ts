import archiver from "archiver";
import { NextFunction, Request, Response } from "express";
import multer from "multer";
import { z } from "zod";
import { DocumentError } from "../services/brain/documentParser";
import {
  DOC_KINDS,
  DocumentHttpError,
  createDocument,
  listDocuments,
  mapDocumentErrorToHttp,
  setDocumentStatus,
  toDocumentSummary,
} from "../services/brain/documents.service";
import {
  DatasetHttpError,
  builtinDefinitions,
  buildTemplateFiles,
  commitImport,
  dryRunImport,
  getDefinitionForCategory,
  listRecords,
  registerDefinition,
  rollbackImport,
  parseDefinition,
} from "../services/brain/datasets.service";
import { reindexCategory } from "../services/brain/indexer.service";
import { MAX_CSV_BYTES } from "../services/brain/csv";
import { fixMulterFilename } from "../services/brain/fileBankAccess";
import { recordBrainAudit } from "../services/brainAudit.service";
import logger from "../utils/logger";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

/** Multer wrapper so upload errors become JSON (413 for size) instead of Express HTML errors. */
export const uploadDocumentFile = (req: Request, res: Response, next: NextFunction): void => {
  upload.single("file")(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      res.status(status).json({ error: status === 413 ? "File exceeds the 20 MB limit." : "Invalid upload.", code: err.code });
      return;
    }
    res.status(400).json({ error: "Invalid upload." });
  });
};

const sendError = (res: Response, error: unknown): void => {
  if (error instanceof DocumentError) {
    const status = mapDocumentErrorToHttp(error.code);
    res.status(status).json({ error: status === 500 ? "Internal server error" : error.message, code: error.code });
    return;
  }
  if (error instanceof DatasetHttpError) {
    res.status(error.statusCode).json({
      error: error.statusCode === 500 ? "Internal server error" : error.message,
      ...(error.code ? { code: error.code } : {}),
    });
    return;
  }
  if (error instanceof DocumentHttpError) {
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  // Never echo raw error messages: they could contain content.
  logger.error("Brain document request failed");
  res.status(500).json({ error: "Internal server error" });
};

const uploadFieldsSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  kind: z.enum(DOC_KINDS as [string, ...string[]]).optional(),
  version: z.string().trim().max(80).optional(),
  source: z.string().trim().max(240).optional(),
  tags: z.string().optional(),
});

const statusSchema = z.object({
  status: z.enum(["active", "archived"]),
  acknowledgeFlags: z.array(z.string().max(200)).max(5000).optional(),
});

export const uploadDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }
    const fields = uploadFieldsSchema.safeParse(req.body ?? {});
    if (!fields.success) {
      res.status(400).json({ error: "Invalid document fields." });
      return;
    }
    const f = fields.data;
    const tags = f.tags ? f.tags.split(",").map((t) => t.trim()).filter(Boolean) : undefined;
    const doc = await createDocument({
      categoryId: req.params.categoryId,
      file: { buffer: req.file.buffer, originalname: fixMulterFilename(req.file.originalname), mimetype: req.file.mimetype },
      meta: { title: f.title, kind: f.kind as never, version: f.version, source: f.source, tags },
      userId: req.user!._id.toString(),
    });
    await recordBrainAudit({
      userId: req.user!._id.toString(),
      action: "BRAIN_DOCUMENT_UPLOADED",
      target: "brain_document",
      metadata: { categoryId: req.params.categoryId, documentId: String(doc._id), status: doc.status, counts: doc.chunkCount },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.status(201).json({ document: toDocumentSummary(doc) });
  } catch (error) {
    sendError(res, error);
  }
};

export const getDocuments = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({ documents: await listDocuments(req.params.categoryId) });
  } catch (error) {
    sendError(res, error);
  }
};

export const patchDocument = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = statusSchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body." });
      return;
    }
    const doc = await setDocumentStatus({
      documentId: req.params.documentId,
      status: body.data.status,
      acknowledgeFlags: body.data.acknowledgeFlags,
      userId: req.user!._id.toString(),
    });
    await recordBrainAudit({
      userId: req.user!._id.toString(),
      action: "BRAIN_DOCUMENT_STATUS_CHANGED",
      target: "brain_document",
      metadata: { categoryId: String(doc.categoryId), documentId: String(doc._id), status: doc.status, counts: doc.chunkCount },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.json({ document: toDocumentSummary(doc) });
  } catch (error) {
    sendError(res, error);
  }
};

// ------------------------------------------------------------------ datasets

const MAX_IMPORT_FILES = 12;

/** The commit is a separate endpoint: only dry runs are accepted here. Runs before any body is read. */
export const requireDryRun = (req: Request, res: Response, next: NextFunction): void => {
  if (req.query.dryRun !== "true") {
    res.status(400).json({ error: "Imports must be started with dryRun=true; commit via /imports/:importId/commit." });
    return;
  }
  next();
};

/** Looks up the dataset definition so the upload can be capped at its table count. */
export const prepareImport = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const def = await getDefinitionForCategory(req.params.categoryId, req.params.key);
    res.locals.importFileLimit = Math.min(def.tables.length, MAX_IMPORT_FILES);
    next();
  } catch (error) {
    sendError(res, error);
  }
};

export const uploadImportFiles = (req: Request, res: Response, next: NextFunction): void => {
  const files = typeof res.locals.importFileLimit === "number" ? res.locals.importFileLimit : MAX_IMPORT_FILES;
  const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_CSV_BYTES, files, fields: 10 } });
  importUpload.any()(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const tooLarge = err.code === "LIMIT_FILE_SIZE";
      res.status(tooLarge ? 413 : 400).json({
        error: tooLarge ? "A CSV file exceeds the 10 MB limit." : "Invalid upload.",
        code: tooLarge ? "IMPORT_TOO_LARGE" : err.code,
      });
      return;
    }
    res.status(400).json({ error: "Invalid upload." });
  });
};

const decodeCsv = (buf: Buffer): string => {
  if (buf.includes(0)) throw new DatasetHttpError(422, "A CSV file is not valid UTF-8 text.", "INVALID_ENCODING");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf); // strips a leading BOM
  } catch {
    throw new DatasetHttpError(422, "A CSV file is not valid UTF-8 text.", "INVALID_ENCODING");
  }
};

const sumAccepted = (report: { files: Record<string, { rowsAccepted: number }> }): number =>
  Object.values(report.files).reduce((n, f) => n + f.rowsAccepted, 0);

export const getDatasetDefinitions = (_req: Request, res: Response): void => {
  res.json({ definitions: builtinDefinitions });
};

export const putDatasetDefinition = async (req: Request, res: Response): Promise<void> => {
  try {
    const parsed = parseDefinition(req.body);
    if (!parsed.ok) {
      res.status(422).json({ error: "Invalid dataset definition.", code: "INVALID_DEFINITION", errors: parsed.errors });
      return;
    }
    const def = parsed.def; // the parsed copy is what gets stored, never the raw body
    if (def.key !== req.params.key) {
      res.status(422).json({ error: "Definition key does not match the URL.", code: "INVALID_DEFINITION", errors: ["key: must equal the URL key"] });
      return;
    }
    await registerDefinition(req.params.categoryId, def, req.user!._id.toString());
    res.json({ ok: true, key: def.key, version: def.version });
  } catch (error) {
    sendError(res, error);
  }
};

export const dryRunDatasetImport = async (req: Request, res: Response): Promise<void> => {
  try {
    const uploaded = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!uploaded.length) {
      res.status(400).json({ error: "No files provided" });
      return;
    }
    const fileMap = new Map<string, string>(); // field names are user input: never use them as plain object keys
    for (const f of uploaded) {
      if (fileMap.has(f.fieldname)) {
        res.status(422).json({ error: "A file was provided more than once.", code: "DUPLICATE_FILE" });
        return;
      }
      fileMap.set(f.fieldname, decodeCsv(f.buffer));
    }
    const files: Record<string, string> = Object.fromEntries(fileMap);
    const userId = req.user!._id.toString();
    const result = await dryRunImport({ categoryId: req.params.categoryId, datasetKey: req.params.key, files, userId });
    await recordBrainAudit({
      userId,
      action: "BRAIN_DATASET_IMPORT_DRYRUN",
      target: "brain_import",
      metadata: {
        categoryId: req.params.categoryId,
        importBatchId: result.importId,
        status: "dry_run",
        counts: sumAccepted(result.report),
        issues: result.report.issueTotal,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.status(201).json(result);
  } catch (error) {
    sendError(res, error);
  }
};

const commitSchema = z.object({ acknowledgeWarnings: z.boolean().optional() });

export const commitDatasetImport = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = commitSchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "Invalid request body." });
      return;
    }
    const userId = req.user!._id.toString();
    const result = await commitImport({
      importId: req.params.importId,
      acknowledgeWarnings: body.data.acknowledgeWarnings === true,
      userId,
    });
    await recordBrainAudit({
      userId,
      action: "BRAIN_DATASET_IMPORT_COMMITTED",
      target: "brain_import",
      metadata: {
        categoryId: result.categoryId,
        importBatchId: req.params.importId,
        status: "committed",
        counts: result.committed,
        issues: result.issues,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.json({ committed: result.committed, revisions: result.revisions });
  } catch (error) {
    sendError(res, error);
  }
};

export const rollbackDatasetImport = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user!._id.toString();
    const result = await rollbackImport(req.params.importId, userId);
    await recordBrainAudit({
      userId,
      action: "BRAIN_DATASET_IMPORT_ROLLED_BACK",
      target: "brain_import",
      metadata: {
        categoryId: result.categoryId,
        importBatchId: req.params.importId,
        status: "rolled_back",
        counts: result.rolledBack,
        issues: 0,
      },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.json({ rolledBack: result.rolledBack, restored: result.restored });
  } catch (error) {
    sendError(res, error);
  }
};

const intParam = (v: unknown, fallback: number): number => {
  const n = Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
};

export const getDatasetRecords = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = intParam(req.query.page, 1);
    const pageSize = intParam(req.query.pageSize, 50);
    if (page < 1 || pageSize < 1 || pageSize > 200) {
      res.status(400).json({ error: "page must be >= 1 and pageSize between 1 and 200." });
      return;
    }
    const result = await listRecords({
      categoryId: req.params.categoryId,
      datasetKey: req.params.key,
      table: req.params.table,
      page,
      pageSize,
    });
    res.json({ ...result, page, pageSize });
  } catch (error) {
    sendError(res, error);
  }
};

export const getDatasetTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const def = await getDefinitionForCategory(req.params.categoryId, req.params.key);
    const files = buildTemplateFiles(def);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${def.key}-template.zip"`);
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", () => {
      logger.error("Brain dataset template zip failed");
      res.destroy();
    });
    archive.pipe(res);
    for (const [name, content] of Object.entries(files)) archive.append(content, { name });
    await archive.finalize();
  } catch (error) {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    sendError(res, error);
  }
};

export const postReindex = async (req: Request, res: Response): Promise<void> => {
  try {
    const counts = await reindexCategory(req.params.categoryId);
    await recordBrainAudit({
      userId: req.user!._id.toString(),
      action: "BRAIN_REINDEX_REQUESTED",
      target: "brain_category",
      metadata: { categoryId: req.params.categoryId, documents: counts.documents, batches: counts.batches },
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || undefined,
    });
    res.status(202).json(counts);
  } catch (error) {
    sendError(res, error);
  }
};
