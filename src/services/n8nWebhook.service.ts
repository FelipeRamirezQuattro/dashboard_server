import axios from "axios";
import { ChatProvider, ChatRequest, ChatResponse } from "../types/chatbot.types";
import logger from "../utils/logger";
import { env } from "../config/env";

/**
 * N8nWebhookProvider
 *
 * Routes every chat message to the configured n8n webhook and maps the
 * response back to the standard ChatResponse shape expected by the controller.
 *
 * Payload sent to n8n:
 *   {
 *     session_id: <user email>,
 *     message: <text>,
 *     selected_source: "auto" | "workflow_brain" | "external_app" | "file_bank",
 *     target: <selected source details>,
 *     context: <chat context>
 *   }
 *
 * Response received from n8n:
 *   {
 *     response: '{"success":true,"reply":"...","confidence":0.95,"timestamp":"...","metadata":{...}}',
 *     session_id: "user@example.com"
 *   }
 *
 * The `response` field is a JSON string — it is parsed here before returning.
 */
export class N8nWebhookProvider implements ChatProvider {
  private readonly webhookUrl: string;

  constructor() {
    this.webhookUrl = env.n8nWebhookUrl;
  }

  async getResponse(
    message: string,
    request?: ChatRequest,
  ): Promise<ChatResponse> {
    const userEmail = request?.userEmail;
    const target = request?.context?.target || request?.target || { type: "auto" };
    const selectedSource = target.type || "auto";

    if (!userEmail) {
      logger.warn("N8nWebhookProvider: no userEmail on request, falling back");
      return {
        reply: "I couldn't identify your session. Please try logging out and back in.",
        timestamp: new Date(),
        confidence: 0,
      };
    }

    try {
      logger.info(
        `N8nWebhookProvider: sending message to n8n for ${userEmail} selected_source=${selectedSource}`,
      );

      const { data } = await axios.post(
        this.webhookUrl,
        {
          session_id: userEmail,
          message,
          selected_source: selectedSource,
          selected_app:
            target.type === "external_app" ? target.appName : undefined,
          workflow_brain_category_id:
            target.type === "workflow_brain"
              ? target.workflowBrainCategoryId
              : request?.workflowBrainCategoryId,
          document_source:
            target.type === "file_bank" ? target.documentSource : undefined,
          target,
          context: request?.context,
          user_id: request?.userId,
          user_email: userEmail,
          session_id_raw: request?.sessionId,
        },
        { timeout: 30_000 },
      );

      // The `response` field is a stringified JSON object — parse it.
      let parsed: {
        success?: boolean;
        reply?: string;
        confidence?: number;
        timestamp?: string;
        metadata?: Record<string, unknown>;
      } = {};

      if (data?.response) {
        try {
          parsed = typeof data.response === "string"
            ? JSON.parse(data.response)
            : data.response;
        } catch {
          // If it somehow isn't valid JSON, treat the raw string as the reply.
          parsed = { reply: String(data.response), confidence: 0.5 };
        }
      }

      const reply = parsed.reply?.trim() || "I received a response but couldn't read it. Please try again.";
      const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.9;
      const timestamp = parsed.timestamp ? new Date(parsed.timestamp) : new Date();

      logger.info(`N8nWebhookProvider: received reply (confidence: ${confidence})`);

      return { reply, timestamp, confidence };
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        if (error.code === "ECONNABORTED") {
          logger.error("N8nWebhookProvider: request timed out");
          return {
            reply: "The request to the AI agent timed out. Please try again in a moment.",
            timestamp: new Date(),
            confidence: 0,
          };
        }
        logger.error(
          `N8nWebhookProvider: HTTP ${error.response?.status} from n8n`,
          error.response?.data,
        );
      } else {
        logger.error("N8nWebhookProvider: unexpected error", error);
      }

      return {
        reply: "I encountered an error while connecting to the AI agent. Please try again later.",
        timestamp: new Date(),
        confidence: 0,
      };
    }
  }
}

export const n8nWebhookProvider = new N8nWebhookProvider();
