import { Request, Response } from "express";
import { chatbotService } from "../services/chatbot.service";
import logger from "../utils/logger";

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // Optional: Log user interaction for analytics
    const userId = req.user?.id || "anonymous";
    logger.info(
      `Chatbot message from user ${userId}: ${message.substring(0, 50)}...`,
    );

    const response = await chatbotService.processMessage(message);

    return res.status(200).json({
      reply: response.reply,
      timestamp: response.timestamp,
      confidence: response.confidence,
    });
  } catch (error) {
    logger.error("Error in chatbot controller:", error);
    return res.status(500).json({ error: "Failed to process message" });
  }
};
