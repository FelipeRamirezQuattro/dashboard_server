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
      file: { buffer: req.file.buffer, originalname: req.file.originalname, mimetype: req.file.mimetype },
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
