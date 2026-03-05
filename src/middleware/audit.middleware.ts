import { Request, Response, NextFunction } from "express";
import AuditLog from "../models/AuditLog.model";
import logger from "../utils/logger";

export const auditLog = (action: string) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const originalSend = res.send;

    res.send = function (data): Response {
      // Only log successful operations (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const logData = {
          userId: req.user?._id,
          action,
          target: req.originalUrl,
          metadata: {
            method: req.method,
            params: req.params,
            query: req.query,
            // Don't log sensitive body data like passwords
            body: sanitizeBody(req.body),
          },
          ipAddress: req.ip || req.socket.remoteAddress,
          userAgent: req.get("user-agent"),
        };

        AuditLog.create(logData).catch((error) => {
          logger.error("Failed to create audit log:", error);
        });
      }

      return originalSend.call(this, data);
    };

    next();
  };
};

const sanitizeBody = (body: any): any => {
  if (!body || typeof body !== "object") {
    return body;
  }

  const sanitized = { ...body };
  const sensitiveFields = [
    "password",
    "passwordHash",
    "token",
    "secret",
    "accessToken",
    "refreshToken",
  ];

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = "[REDACTED]";
    }
  }

  return sanitized;
};

export default auditLog;
