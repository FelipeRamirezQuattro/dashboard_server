import axios from "axios";
import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { env } from "../config/env";
import ExternalApp from "../models/App.model";
import { resolveUserPermissions } from "../services/permissions.service";
import { recordChatbotAutomationAudit } from "../services/chatbotAutomationAudit.service";
import logger from "../utils/logger";
import crypto from "crypto";

const router = Router();

const INTERNAL_AI_APP_NAME = "Internal AI Assistant";

const sanitizeContentDisposition = (
  value: unknown,
  fallbackFileName: string,
): string => {
  if (typeof value !== "string") {
    return `attachment; filename="${fallbackFileName}"`;
  }

  const match = value.match(/filename="?([^";\r\n]+)"?/i);
  const rawFileName = match?.[1] || fallbackFileName;
  const safeFileName = rawFileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 160);

  return `attachment; filename="${safeFileName || fallbackFileName}"`;
};

const resolveFileDownloadUrl = (chatbotApiUrl: string, fileId: string): string => {
  const normalizedUrl = chatbotApiUrl.replace(/\/$/, "");
  const encodedFileId = encodeURIComponent(fileId);

  try {
    const parsed = new URL(normalizedUrl);
    const path = parsed.pathname.replace(/\/$/, "");

    if (path.endsWith("/chatbot/query")) {
      parsed.pathname = `${path.slice(0, -"/chatbot/query".length)}/files/${encodedFileId}/download`;
      parsed.search = "";
      return parsed.toString();
    }

    parsed.pathname = `${path}/files/${encodedFileId}/download`;
    parsed.search = "";
    return parsed.toString();
  } catch {
    return `${normalizedUrl}/files/${encodedFileId}/download`;
  }
};

// GET /api-dashboard/internal-ai/files/:id/download
router.get(
  "/files/:id/download",
  authenticate,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const app = await ExternalApp.findOne({ name: INTERNAL_AI_APP_NAME });
      if (!app || !app.isActive || !app.chatbotApiUrl) {
        res.status(503).json({
          error: "Internal AI Assistant file service is not configured.",
        });
        return;
      }

      const fileUrl = resolveFileDownloadUrl(app.chatbotApiUrl, req.params.id);
      const requestId = req.header("X-Request-ID") || crypto.randomUUID();
      const userId = req.user?.id;
      const permissions =
        userId && req.user?.role
          ? await resolveUserPermissions(userId, req.user.role)
          : { businessUnits: [], departments: [], applications: [] };
      const response = await axios.get(fileUrl, {
        responseType: "stream",
        timeout: env.chatbotConnectorTimeoutMs,
        headers: {
          ...(env.internalAiAssistantChatbotApiKey && {
            "X-API-Key": env.internalAiAssistantChatbotApiKey,
          }),
          "X-Request-ID": requestId,
          "X-User-ID": userId || "",
          "X-User-Email": req.user?.email || "",
          "X-User-Role": req.user?.role || "",
          "X-Allowed-Business-Units": JSON.stringify(permissions.businessUnits),
          "X-Allowed-Departments": JSON.stringify(permissions.departments),
        },
      });

      await recordChatbotAutomationAudit({
        userId,
        action: "INTERNAL_AI_FILE_DOWNLOAD",
        target: req.params.id,
        metadata: {
          requestId,
          fileId: req.params.id,
          success: true,
        },
        ipAddress: req.ip || req.socket.remoteAddress,
        userAgent: req.get("user-agent"),
      });

      res.status(response.status);
      res.setHeader(
        "Content-Type",
        response.headers["content-type"] || "application/octet-stream",
      );
      if (response.headers["content-disposition"]) {
        res.setHeader(
          "Content-Disposition",
          sanitizeContentDisposition(
            response.headers["content-disposition"],
            `${req.params.id}.download`,
          ),
        );
      }

      response.data.on("error", (error: Error) => {
        logger.error("Internal AI Assistant file stream failed:", error);
        if (!res.headersSent) {
          res.status(500).json({ error: "Failed to stream file" });
        }
      });
      response.data.pipe(res);
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        await recordChatbotAutomationAudit({
          userId: req.user?.id,
          action: "INTERNAL_AI_AUTHZ_DENIED",
          target: req.params.id,
          metadata: {
            requestId: req.header("X-Request-ID"),
            fileId: req.params.id,
            status: 403,
          },
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.get("user-agent"),
        });
        res.status(403).json({ error: "You do not have access to this file." });
        return;
      }

      if (axios.isAxiosError(error) && error.response?.status === 404) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      logger.error("Internal AI Assistant file proxy failed:", error);
      res.status(502).json({
        error: "Failed to download file from Internal AI Assistant.",
      });
    }
  },
);

export default router;
