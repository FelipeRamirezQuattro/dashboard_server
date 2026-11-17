import crypto from "crypto";
import path from "path";
import mongoose from "mongoose";
import { BrainDocument, IBrainDocument } from "../../models/BrainKnowledge.model";
import { BrainMemory } from "../../models/WorkflowBrain.model";
import FileBank from "../../models/FileBank.model";
import { s3FileStorageService } from "../s3FileStorage.service";
import {
  DocKind,
  DocSection,
  DocumentError,
  InjectionFlag,
  chunkSections,
  flagKey,
  parseMarkdownDocument,
  sanitizeText,
  scanForInjection,
} from "./documentParser";
import { PdfPage, extractPdfPages } from "./pdfExtractor";
import { scheduleDocumentEmbedding } from "./indexer.service";
import logger from "../../utils/logger";

export const MAX_ACTIVE_DOCUMENTS = 50;
export const DOC_KINDS: DocKind[] = ["facts", "guidance", "glossary", "procedure"];

/** HTTP-aware error for conditions that are not DocumentError codes. */
export class DocumentHttpError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "DocumentHttpError";
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, DocumentHttpError.prototype);
  }
}

export const mapDocumentErrorToHttp = (code: string): number => {
  switch (code) {
    case "MISSING_FRONT_MATTER":
    case "MISSING_TITLE":
    case "INVALID_KIND":
    case "NO_EXTRACTABLE_TEXT":
    case "INVALID_PDF":
    case "TOO_MANY_PAGES":
    case "FLAGS_NOT_ACKNOWLEDGED":
      return 422;
    case "TOO_LARGE":
      return 413;
    default:
      return 500;
  }
};

export interface StoredFlag {
  id: string;
  line: number;
  excerpt: string;
  acknowledged: boolean;
}

/**
 * Flag key format (what the UI echoes back in `acknowledgeFlags`): `flagKey(flag)` = `${flag.id}:${flag.line}`.
 * Markdown flags: id = pattern id (e.g. "ignore_previous"), line = 1-based line in the RAW file.
 * PDF flags: id = `${patternId}:p${page}`, line = 1-based line within that page's raw text,
 * so the key is e.g. "ignore_previous:p3:5" and stays unique across pages.
 */
export const flagKeyOf = (flag: { id: string; line: number }): string => flagKey(flag);

/** Scan RAW markdown text (including HTML comments / hidden regions), never sanitized text. */
export const buildUploadFlags = (rawText: string): StoredFlag[] =>
  scanForInjection(rawText).map((f: InjectionFlag) => ({
    id: f.id,
    line: f.line,
    excerpt: f.excerpt.slice(0, 80),
    acknowledged: false,
  }));

/** Scan RAW extracted text per page; lines are numbered per page. */
export const buildPdfUploadFlags = (pages: PdfPage[]): StoredFlag[] =>
  pages.flatMap((p) =>
    scanForInjection(p.text).map((f) => ({
      id: `${f.id}:p${p.page}`,
      line: f.line,
      excerpt: f.excerpt.slice(0, 80),
      acknowledged: false,
    })),
  );

export const assertActivatable = (
  flags: { id: string; line: number; acknowledged?: boolean }[],
  acknowledged: string[] = [],
): void => {
  const ack = new Set(acknowledged);
  if (flags.some((f) => !ack.has(flagKey(f)))) {
    throw new DocumentError(
      "FLAGS_NOT_ACKNOWLEDGED",
      "This document has flagged lines that must be acknowledged before activation.",
    );
  }
};

export const decideDuplicate = (existing: { status: string }[]): boolean =>
  existing.some((d) => d.status === "draft" || d.status === "active");

export interface ChunkPayload {
  heading: string;
  chunkIndex: number;
  page?: number;
  content: string;
}

const toPayloads = (chunks: DocSection[]): ChunkPayload[] =>
  chunks
    .filter((c) => c.text.trim().length > 0)
    .map((c, i) => {
      const p: ChunkPayload = { heading: c.heading, chunkIndex: i, content: c.text };
      if (c.page !== undefined) p.page = c.page;
      return p;
    });

export const buildMdChunks = (sections: { heading: string; text: string }[]): ChunkPayload[] =>
  toPayloads(chunkSections(sections));

export const buildPdfChunks = (pages: PdfPage[]): ChunkPayload[] => {
  const sections: DocSection[] = [];
  for (const p of pages) {
    const text = sanitizeText(p.text);
    if (!text.trim()) continue;
    sections.push({ heading: `Page ${p.page}`, text, page: p.page });
  }
  return toPayloads(chunkSections(sections));
};

export interface DocMeta {
  title: string;
  kind: DocKind;
  version?: string;
  source?: string;
  tags?: string[];
}

export const detectSourceFormat = (originalname: string, mimetype: string): "md" | "pdf" | null => {
  const ext = path.extname(originalname || "").toLowerCase();
  const mime = (mimetype || "").toLowerCase();
  if (ext === ".pdf" && mime === "application/pdf") return "pdf";
  if (ext === ".md" && (mime === "text/markdown" || mime === "text/plain" || mime === "text/x-markdown")) return "md";
  return null;
};

export const createDocument = async (p: {
  categoryId: string;
  file: { buffer: Buffer; originalname: string; mimetype: string };
  meta?: Partial<DocMeta>;
  userId: string;
}): Promise<IBrainDocument> => {
  const format = detectSourceFormat(p.file.originalname, p.file.mimetype);
  if (!format) throw new DocumentHttpError(415, "Only .md and .pdf files are supported.");
  if (format === "pdf" && !s3FileStorageService.isConfigured()) {
    throw new DocumentHttpError(503, "File Bank storage is not configured.");
  }

  const contentHash = crypto.createHash("sha256").update(p.file.buffer).digest("hex");
  const existing = await BrainDocument.find({ categoryId: p.categoryId, contentHash }).select("status").lean();
  if (decideDuplicate(existing as { status: string }[])) {
    throw new DocumentHttpError(409, "This file was already uploaded.");
  }

  let meta: DocMeta;
  let flags: StoredFlag[];
  let chunks: ChunkPayload[];

  if (format === "md") {
    const raw = p.file.buffer.toString("utf8");
    const parsed = parseMarkdownDocument(raw);
    meta = {
      title: p.meta?.title || parsed.meta.title,
      kind: p.meta?.kind || parsed.meta.kind,
      version: p.meta?.version || parsed.meta.version,
      source: p.meta?.source || parsed.meta.source,
      tags: p.meta?.tags && p.meta.tags.length ? p.meta.tags : parsed.meta.tags,
    };
    flags = buildUploadFlags(raw);
    chunks = buildMdChunks(parsed.sections);
  } else {
    if (!p.meta?.title || !p.meta.kind) {
      throw new DocumentError("MISSING_TITLE", "PDF uploads require a title and kind.");
    }
    meta = { ...p.meta, title: p.meta.title, kind: p.meta.kind };
    const pages = await extractPdfPages(p.file.buffer);
    flags = buildPdfUploadFlags(pages);
    chunks = buildPdfChunks(pages);
  }
  if (!chunks.length) throw new DocumentError("NO_EXTRACTABLE_TEXT", "The document has no usable text.");

  let fileBankId: mongoose.Types.ObjectId | undefined;
  if (format === "pdf") {
    const fileId = new mongoose.Types.ObjectId();
    const storedName = `${crypto.randomUUID()}.pdf`;
    const s3Key = `file-bank/${storedName}`;
    await s3FileStorageService.uploadObject(s3Key, p.file.buffer, p.file.mimetype);
    await new FileBank({
      _id: fileId,
      originalName: p.file.originalname,
      storedName,
      mimeType: p.file.mimetype,
      sizeBytes: p.file.buffer.length,
      description: `Brain document: ${meta.title}`,
      tags: ["brain-document", p.categoryId],
      contentText: "",
      source: "local",
      storageProvider: "s3",
      s3Key,
      syncStatus: "indexed",
      uploadedBy: p.userId,
      uploadedAt: new Date(),
      filePath: s3FileStorageService.toUri(s3Key),
      downloadUrl: `/file-bank/${fileId}/download`,
    }).save();
    fileBankId = fileId;
  }

  const doc = await BrainDocument.create({
    categoryId: p.categoryId,
    title: meta.title,
    kind: meta.kind,
    version: meta.version,
    status: "draft",
    sourceFormat: format,
    contentHash,
    sizeBytes: p.file.buffer.length,
    fileBankId,
    flags,
    tags: meta.tags ?? [],
    source: meta.source,
    chunkCount: chunks.length,
    embeddingStatus: "none",
    uploadedBy: p.userId,
  });

  try {
    await BrainMemory.insertMany(
      chunks.map((c) => ({
        categoryId: p.categoryId,
        type: "document_chunk",
        source: "document",
        documentId: doc._id,
        documentVersion: doc.version ?? "1",
        heading: c.heading,
        chunkIndex: c.chunkIndex,
        ...(c.page !== undefined ? { page: c.page } : {}),
        content: c.content,
        summary: "",
        confidence: 1,
        createdBy: p.userId,
      })),
    );
  } catch (error) {
    logger.error(`Brain document chunk insert failed for document ${doc._id}`);
    await BrainMemory.deleteMany({ documentId: doc._id }).catch(() => undefined);
    await BrainDocument.deleteOne({ _id: doc._id }).catch(() => undefined);
    throw new DocumentHttpError(500, "Failed to store document chunks.");
  }
  return doc;
};

export const setDocumentStatus = async (p: {
  documentId: string;
  status: "active" | "archived";
  acknowledgeFlags?: string[];
  userId: string;
}): Promise<IBrainDocument> => {
  const doc = await BrainDocument.findById(p.documentId);
  if (!doc) throw new DocumentHttpError(404, "Not found");
  if (doc.status === p.status) return doc; // no-op

  if (p.status === "archived") {
    doc.status = "archived";
    await doc.save();
    return doc;
  }

  // activate (from draft or archived)
  assertActivatable(doc.flags, p.acknowledgeFlags ?? []);
  const previous = await BrainDocument.findOne({
    categoryId: doc.categoryId,
    title: doc.title,
    status: "active",
    _id: { $ne: doc._id },
  });
  const activeCount = await BrainDocument.countDocuments({ categoryId: doc.categoryId, status: "active" });
  const projected = activeCount + 1 - (previous ? 1 : 0);
  if (projected > MAX_ACTIVE_DOCUMENTS) {
    throw new DocumentHttpError(409, `A category can have at most ${MAX_ACTIVE_DOCUMENTS} active documents.`);
  }

  doc.flags.forEach((f) => {
    f.acknowledged = true;
  });
  doc.status = "active";
  doc.activatedBy = new mongoose.Types.ObjectId(p.userId);
  doc.activatedAt = new Date();
  doc.embeddingStatus = "pending";
  await doc.save();

  if (previous) {
    previous.status = "archived";
    previous.supersededById = doc._id as mongoose.Types.ObjectId;
    await previous.save();
  }
  scheduleDocumentEmbedding(String(doc._id));
  return doc;
};

export const listDocuments = async (categoryId: string) => {
  const docs = await BrainDocument.find({ categoryId }).sort({ createdAt: -1 }).lean();
  return docs.map((d) => ({
    id: String(d._id),
    title: d.title,
    kind: d.kind,
    version: d.version,
    status: d.status,
    sourceFormat: d.sourceFormat,
    flags: (d.flags ?? []).map((f) => ({
      key: flagKey(f),
      id: f.id,
      line: f.line,
      excerpt: f.excerpt,
      acknowledged: f.acknowledged,
    })),
    chunkCount: d.chunkCount,
    embeddingStatus: d.embeddingStatus,
    fileBankId: d.fileBankId ? String(d.fileBankId) : undefined,
    uploadedBy: String(d.uploadedBy),
    createdAt: d.createdAt,
  }));
};

export const toDocumentSummary = (d: IBrainDocument) => ({
  id: String(d._id),
  title: d.title,
  kind: d.kind,
  version: d.version,
  status: d.status,
  sourceFormat: d.sourceFormat,
  flags: d.flags.map((f) => ({ key: flagKey(f), id: f.id, line: f.line, excerpt: f.excerpt, acknowledged: f.acknowledged })),
  chunkCount: d.chunkCount,
  embeddingStatus: d.embeddingStatus,
  fileBankId: d.fileBankId ? String(d.fileBankId) : undefined,
  uploadedBy: String(d.uploadedBy),
  createdAt: d.createdAt,
});
