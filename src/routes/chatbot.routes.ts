import { Router } from "express";
import { Request, Response, NextFunction } from "express";
import {
  getHistory,
  searchDocuments,
  sendMessage,
} from "../controllers/chatbot.controller";
import { authenticate } from "../middleware/auth.middleware";
import { env } from "../config/env";

const router = Router();

const authenticateToolOrUser = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization || "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  const apiKey = req.headers["x-api-key"];
  const presentedKey = bearer || (Array.isArray(apiKey) ? apiKey[0] : apiKey);

  if (env.chatbotToolApiKey && presentedKey === env.chatbotToolApiKey) {
    next();
    return;
  }

  authenticate(req, res, next);
};

// POST /api/chatbot/message - Send a message to the chatbot
router.post("/message", authenticate, sendMessage);
router.get("/history", authenticate, getHistory);
router.post("/tools/document-search", authenticateToolOrUser, searchDocuments);

export default router;
