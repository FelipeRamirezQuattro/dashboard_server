import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.model";
import logger from "../utils/logger";

export type ChatbotAutomationAuditAction =
  | "CHAT_ROUTE_DECISION"
  | "CHAT_EXTERNAL_APP_QUERY"
  | "INTERNAL_AI_FILE_DOWNLOAD"
  | "INTERNAL_AI_AUTHZ_DENIED"
  | "INTERNAL_AI_CONTRACT_ERROR"
  | "CHAT_APP_AUTHZ_DENIED";

interface ChatbotAutomationAuditInput {
  userId?: string;
  action: ChatbotAutomationAuditAction;
  target: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

const toObjectId = (value?: string): mongoose.Types.ObjectId | undefined => {
  if (!value || !mongoose.isValidObjectId(value)) return undefined;
  return new mongoose.Types.ObjectId(value);
};

export const recordChatbotAutomationAudit = async ({
  userId,
  action,
  target,
  metadata = {},
  ipAddress,
  userAgent,
}: ChatbotAutomationAuditInput): Promise<void> => {
  try {
    await AuditLog.create({
      userId: toObjectId(userId),
      action,
      target,
      metadata,
      ipAddress,
      userAgent,
    });
  } catch (error) {
    logger.error("Failed to create chatbot automation audit log:", error);
  }
};
