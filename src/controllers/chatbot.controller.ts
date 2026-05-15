import { Request, Response } from "express";
import { chatbotOrchestrator } from "../services/chatbotOrchestrator.service";
import { documentSearchService } from "../services/documentSearch.service";
import logger from "../utils/logger";

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { message, sessionId, context } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const userId = req.user?.id || "anonymous";
    const effectiveSessionId = sessionId || `default-${userId}`;

    logger.info(
      `Chatbot message from user ${userId}: ${message.substring(0, 50)}...`,
    );

    const userEmail = req.user?.email;
    const response = await chatbotOrchestrator.processMessage({
      message,
      userId,
      userEmail,
      sessionId: effectiveSessionId,
      context,
    });

    return res.status(200).json({
      reply: response.reply,
      timestamp: response.timestamp,
      confidence: response.confidence,
      sessionId: effectiveSessionId,
      source: response.source,
      routedTo: response.routedTo,
      documents: response.documents,
    });
  } catch (error) {
    logger.error("Error in chatbot controller:", error);
    return res.status(500).json({ error: "Failed to process message" });
  }
};

export const getHistory = async (req: Request, res: Response) => {
  try {
    const sessionId = String(req.query.sessionId || "");
    const userId = req.user?.id;

    if (!userId || !sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const history = await chatbotOrchestrator.getHistory(userId, sessionId);
    return res.status(200).json({ sessionId, history });
  } catch (error) {
    logger.error("Error fetching chatbot history:", error);
    return res.status(500).json({ error: "Failed to fetch chat history" });
  }
};

export const searchDocuments = async (req: Request, res: Response) => {
  try {
    const { query, limit = 5 } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }

    const documents = await documentSearchService.search(query, Number(limit));
    return res.status(200).json({ documents });
  } catch (error) {
    logger.error("Error searching chatbot documents:", error);
    return res.status(500).json({ error: "Failed to search documents" });
  }
};
