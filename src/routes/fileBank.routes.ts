import { Router, Request, Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import mongoose from "mongoose";
import { authenticate } from "../middleware/auth.middleware";
import { requireAdmin } from "../middleware/role.middleware";
import FileBank from "../models/FileBank.model";
import logger from "../utils/logger";

const router = Router();

// Ensure upload directory exists at module load time
const UPLOAD_DIR = path.join(process.cwd(), "uploads", "file-bank");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer disk storage — UUID-based filenames to avoid collisions
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const storedName = `${crypto.randomUUID()}${ext}`;
    cb(null, storedName);
  },
});

const upload = multer({
  storage,
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
      const downloadUrl = `/api-dashboard/file-bank/${fileId}/download`;

      const fileBank = new FileBank({
        _id: fileId,
        originalName: req.file.originalname,
        storedName: req.file.filename,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        description,
        tags: parsedTags,
        uploadedBy: req.user?.id || "unknown",
        uploadedAt: new Date(),
        filePath: req.file.path,
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

// GET /api-dashboard/file-bank/:id/download
router.get(
  "/:id/download",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        res.status(400).json({ error: "Invalid file ID" });
        return;
      }
      const fileRecord = await FileBank.findById(req.params.id);
      if (!fileRecord) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      if (!fs.existsSync(fileRecord.filePath)) {
        res.status(404).json({ error: "File missing from disk" });
        return;
      }

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileRecord.originalName}"`,
      );
      res.setHeader("Content-Type", fileRecord.mimeType);

      const stream = fs.createReadStream(fileRecord.filePath);
      stream.on("error", (err) => {
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
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        res.status(400).json({ error: "Invalid file ID" });
        return;
      }
      const fileRecord = await FileBank.findById(req.params.id);
      if (!fileRecord) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      if (fs.existsSync(fileRecord.filePath)) {
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
