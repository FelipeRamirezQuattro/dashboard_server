import { Request, Response } from "express";
import { chatbotService } from "../services/chatbot.service";
import logger from "../utils/logger";
import {
  appendConversationTurns,
  getConversationHistory,
} from "../services/conversation.service";

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { message, sessionId, context } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Optional: Log user interaction for analytics
    const userId = req.user?.id || "anonymous";
    const effectiveSessionId = sessionId || `default-${userId || "anonymous"}`;

    // Pull persisted context from MongoDB so conversation survives reloads.
    const persistedHistory = req.user?.id
      ? await getConversationHistory(req.user.id, effectiveSessionId)
      : [];

    const mergedHistory = [
      ...persistedHistory,
      ...((context?.history || []) as Array<{
        role: "user" | "assistant";
        content: string;
      }>),
    ].slice(-12);

    logger.info(
      `Chatbot message from user ${userId}: ${message.substring(0, 50)}...`,
    );

    const response = await chatbotService.processMessage({
      message,
      userId,
      sessionId: effectiveSessionId,
      context: {
        history: mergedHistory,
      },
    });

    if (req.user?.id) {
      await appendConversationTurns(req.user.id, effectiveSessionId, [
        { role: "user", content: message },
        { role: "assistant", content: response.reply },
      ]);
    }

    return res.status(200).json({
      reply: response.reply,
      timestamp: response.timestamp,
      confidence: response.confidence,
      sessionId: effectiveSessionId,
    });
  } catch (error) {
    logger.error("Error in chatbot controller:", error);
    return res.status(500).json({ error: "Failed to process message" });
  }
};

export const getHistory = async (req: Request, res: Response) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const sessionId = String(req.query.sessionId || "").trim();
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const history = await getConversationHistory(req.user.id, sessionId, 50);
    return res.status(200).json({ sessionId, history });
  } catch (error) {
    logger.error("Error fetching chatbot history:", error);
    return res.status(500).json({ error: "Failed to fetch chatbot history" });
  }
};
