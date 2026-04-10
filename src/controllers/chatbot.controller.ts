import { Request, Response } from "express";
import { chatbotService } from "../services/chatbot.service";
import { n8nWebhookProvider } from "../services/n8nWebhook.service";
import { env } from "../config/env";
import logger from "../utils/logger";

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { message, sessionId, context } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const userId = req.user?.id || "anonymous";
    const effectiveSessionId = sessionId || `default-${userId}`;

    // Use only the context sent by the client (session-only, no DB persistence).
    const history = ((context?.history || []) as Array<{
      role: "user" | "assistant";
      content: string;
    }>).slice(-12);

    logger.info(
      `Chatbot message from user ${userId}: ${message.substring(0, 50)}...`,
    );

    const userEmail = req.user?.email;

    // Switch between n8n webhook approach and legacy hybrid approach via env flag.
    // Set ENABLE_N8N_CHATBOT=true in .env to use the n8n workflow.
    const response = env.enableN8nChatbot
      ? await n8nWebhookProvider.getResponse(message, {
          message,
          userId,
          userEmail,
          sessionId: effectiveSessionId,
          context: { history },
        })
      : await chatbotService.processMessage({
          message,
          userId,
          userEmail,
          sessionId: effectiveSessionId,
          context: { history },
        });

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
