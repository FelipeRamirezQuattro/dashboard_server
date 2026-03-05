import { Router } from "express";
import { sendMessage } from "../controllers/chatbot.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// POST /api/chatbot/message - Send a message to the chatbot
router.post("/message", authenticate, sendMessage);

export default router;
