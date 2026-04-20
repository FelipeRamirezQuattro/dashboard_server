import { Request, Response } from "express";
import { chatbotService } from "../services/chatbot.service";
import { n8nWebhookProvider } from "../services/n8nWebhook.service";
import { documentLookupService } from "../services/documentLookup.service";
import { tryDirectAppRoute } from "../services/directAppRouter.service";
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
    const history = (
      (context?.history || []) as Array<{
        role: "user" | "assistant";
        content: string;
      }>
    ).slice(-12);

    logger.info(
      `Chatbot message from user ${userId}: ${message.substring(0, 50)}...`,
    );

    const userEmail = req.user?.email;

    // ── Step 1a: Static document registry (instant, zero-cost) ─────
    const docResponse = documentLookupService.lookup(message);
    if (docResponse) {
      logger.info(`Document match found for: "${message.substring(0, 50)}..."`);
      return res.status(200).json({
        reply: docResponse.reply,
        timestamp: docResponse.timestamp,
        confidence: docResponse.confidence,
        sessionId: effectiveSessionId,
      });
    }

    // ── Step 1b: File Bank text search ──────────────────────────────
    const fileBankResponse = await documentLookupService.fileBankSearch(message);
    if (fileBankResponse) {
      logger.info(`File Bank match found for: "${message.substring(0, 50)}..."`);
      return res.status(200).json({
        reply: fileBankResponse.reply,
        timestamp: fileBankResponse.timestamp,
        confidence: fileBankResponse.confidence,
        sessionId: effectiveSessionId,
      });
    }

    // ── Step 2: Direct app routing via pattern match ────────────────
    // If the message matches a known app pattern (Designer, Chemical Tracker, etc.)
    // call that app's chatbot API directly — no n8n or AI needed.
    const appResponse = await tryDirectAppRoute(message, userId, { history });
    if (appResponse) {
      logger.info(`Direct app route matched for: "${message.substring(0, 50)}..."`);
      return res.status(200).json({
        reply: appResponse.reply,
        timestamp: appResponse.timestamp,
        confidence: appResponse.confidence,
        sessionId: effectiveSessionId,
      });
    }

    // ── Step 3: n8n webhook or legacy hybrid provider ───────────────
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
