import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import mongoose from "mongoose";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/role.middleware";
import FileBank from "../models/FileBank.model";
import { extractTextFromBuffer } from "../services/documentText.service";
import { oneDriveService } from "../services/oneDrive.service";
import { s3FileStorageService } from "../services/s3FileStorage.service";
import logger from "../utils/logger";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB max
});

// POST /api-dashboard/file-bank/upload
router.post(
  "/upload",
  authenticate,
  requireAdmin,
  upload.single("file"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No file provided" });
        return;
      }

      if (!s3FileStorageService.isConfigured()) {
        res.status(503).json({
          error:
            "File Bank S3 storage is not configured. Set AWS_REGION and AWS_S3_BUCKET.",
        });
        return;
      }

      const { description = "", tags = "" } = req.body as {
        description?: string;
        tags?: string;
      };

      const parsedTags = tags
        ? tags
            .split(",")
            .map((t: string) => t.trim())
            .filter(Boolean)
        : [];

      const fileId = new mongoose.Types.ObjectId();
      const ext = path.extname(req.file.originalname);
      const storedName = `${crypto.randomUUID()}${ext}`;
      const s3Key = `file-bank/${storedName}`;
      const downloadUrl = `/file-bank/${fileId}/download`;
      const contentText = await extractTextFromBuffer(
        req.file.buffer,
        req.file.mimetype,
        req.file.originalname,
      );

      await s3FileStorageService.uploadObject(
        s3Key,
        req.file.buffer,
        req.file.mimetype,
      );

      const fileBank = new FileBank({
        _id: fileId,
        originalName: req.file.originalname,
        storedName,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        description,
        tags: parsedTags,
        contentText,
        source: "local",
        storageProvider: "s3",
        s3Key,
        syncStatus: "indexed",
        uploadedBy: req.user?.id || "unknown",
        uploadedAt: new Date(),
        filePath: s3FileStorageService.toUri(s3Key),
        downloadUrl,
      });

      await fileBank.save();

      logger.info(
        `File uploaded: ${req.file.originalname} by ${req.user?.email}`,
      );

      res.status(201).json({ file: fileBank.toJSON() });
    } catch (error) {
      logger.error("Error uploading file:", error);
      res.status(500).json({ error: "Failed to upload file" });
    }
  },
);

// GET /api-dashboard/file-bank
router.get(
  "/",
  authenticate,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const files = await FileBank.find().sort({ uploadedAt: -1 });
      res.json({ files });
    } catch (error) {
      logger.error("Error fetching file bank:", error);
      res.status(500).json({ error: "Failed to fetch files" });
    }
  },
);

// POST /api-dashboard/file-bank/onedrive/sync
router.post(
  "/onedrive/sync",
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const result = await oneDriveService.syncFolder();
      res.json({ message: "OneDrive sync completed", ...result });
    } catch (error) {
      logger.error("OneDrive sync failed:", error);
      res.status(500).json({
        error: (error as Error).message || "Failed to sync OneDrive folder",
      });
    }
  },
);

// GET /api-dashboard/file-bank/onedrive/status
router.get(
  "/onedrive/status",
  authenticate,
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await oneDriveService.getStatus());
    } catch (error) {
      logger.error("OneDrive status failed:", error);
      res.status(500).json({ error: "Failed to get OneDrive status" });
    }
  },
);

// GET /api-dashboard/file-bank/:id/download
router.get(
  "/:id/download",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(400).json({ error: "Invalid file ID" });
        return;
      }
      const fileRecord = await FileBank.findById(req.params.id);
      if (!fileRecord) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      if (
        fileRecord.storageProvider !== "s3" &&
        (!fileRecord.filePath || !fs.existsSync(fileRecord.filePath))
      ) {
        res.status(404).json({ error: "File missing from disk" });
        return;
      }

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileRecord.originalName}"`,
      );
      res.setHeader("Content-Type", fileRecord.mimeType);

      const stream =
        fileRecord.storageProvider === "s3" && fileRecord.s3Key
          ? await s3FileStorageService.getObjectStream(fileRecord.s3Key)
          : fs.createReadStream(fileRecord.filePath);

      stream.on("error", (err: Error) => {
        logger.error("Error streaming file:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream file" });
        }
      });
      stream.pipe(res);
    } catch (error) {
      logger.error("Error downloading file:", error);
      res.status(500).json({ error: "Failed to download file" });
    }
  },
);

// DELETE /api-dashboard/file-bank/:id
router.delete(
  "/:id",
  authenticate,
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!mongoose.isValidObjectId(req.params.id)) {
        res.status(400).json({ error: "Invalid file ID" });
        return;
      }
      const fileRecord = await FileBank.findById(req.params.id);
      if (!fileRecord) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      if (fileRecord.storageProvider === "s3" && fileRecord.s3Key) {
        await s3FileStorageService.deleteObject(fileRecord.s3Key);
      } else if (fileRecord.filePath && fs.existsSync(fileRecord.filePath)) {
        fs.unlinkSync(fileRecord.filePath);
      }

      await FileBank.findByIdAndDelete(req.params.id);

      logger.info(`File deleted: ${fileRecord.originalName}`);
      res.json({ message: "File deleted successfully" });
    } catch (error) {
      logger.error("Error deleting file:", error);
      res.status(500).json({ error: "Failed to delete file" });
    }
  },
);

export default router;
