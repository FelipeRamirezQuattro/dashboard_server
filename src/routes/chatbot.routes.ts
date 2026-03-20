import { Router } from "express";
import { getHistory, sendMessage } from "../controllers/chatbot.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// POST /api/chatbot/message - Send a message to the chatbot
router.post("/message", authenticate, sendMessage);

// GET /api/chatbot/history?sessionId=... - Get persisted conversation history
router.get("/history", authenticate, getHistory);

export default router;
