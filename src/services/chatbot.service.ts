import {
  ChatProvider,
  ChatRequest,
  ChatResponse,
} from "../types/chatbot.types";
import { intents, fallbackResponse } from "../config/intents";
import logger from "../utils/logger";
import { chemicalTrackerService } from "./chemicalTracker.service";
import { AIChatProvider as _AIChatProvider } from "./ai.provider"; // retained for future use
import { appRouterService } from "./appRouter.service";
import { env } from "../config/env";
import Anthropic from "@anthropic-ai/sdk";
import FileBank from "../models/FileBank.model";
import ExternalApp from "../models/App.model";

const slugify = (name: string): string => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return /^[0-9]/.test(slug) ? `app_${slug}` : slug;
};

/**
 * HardcodedChatProvider
 * Provides chatbot responses based on hardcoded intents and pattern matching.
 * This will be replaced with AIChatProvider in the future.
 */
class HardcodedChatProvider implements ChatProvider {
  async getResponse(
    message: string,
    request?: ChatRequest,
  ): Promise<ChatResponse> {
    const normalizedMessage = message.trim().toLowerCase();

    // Try to match against patterns
    for (const intent of intents) {
      // Check regex patterns
      for (const pattern of intent.patterns) {
        if (pattern instanceof RegExp && pattern.test(message)) {
          logger.info(`Intent matched: ${pattern}`);

          // Check if this should route to an external app
          if (intent.response.startsWith("ROUTE:")) {
            const appName = intent.response.replace("ROUTE:", "").trim();
            logger.info(`Pattern matched - routing to ${appName}`);
            return await this.routeToApp(appName, message, request);
          }

          // Check if this is an external app query (legacy)
          if (intent.response.startsWith("EXTERNAL_QUERY:")) {
            const queryType = intent.response.replace("EXTERNAL_QUERY:", "");
            return await this.handleExternalQuery(queryType);
          }

          return {
            reply: intent.response,
            timestamp: new Date(),
            confidence: 1.0,
          };
        }
      }

      // Check if all keywords are present (as a secondary matching method)
      if (intent.keywords) {
        const matchedKeywords = intent.keywords.filter((keyword) =>
          normalizedMessage.includes(keyword.toLowerCase()),
        );

        // If more than 60% of keywords match, consider it a match
        if (matchedKeywords.length / intent.keywords.length > 0.6) {
          logger.info(
            `Intent matched by keywords: ${matchedKeywords.join(", ")}`,
          );

          // Check if this should route to an external app
          if (intent.response.startsWith("ROUTE:")) {
            const appName = intent.response.replace("ROUTE:", "").trim();
            logger.info(`Keywords matched - routing to ${appName}`);
            return await this.routeToApp(appName, message, request);
          }

          // Check if this is an external app query (legacy)
          if (intent.response.startsWith("EXTERNAL_QUERY:")) {
            const queryType = intent.response.replace("EXTERNAL_QUERY:", "");
            return await this.handleExternalQuery(queryType);
          }

          return {
            reply: intent.response,
            timestamp: new Date(),
            confidence: matchedKeywords.length / intent.keywords.length,
          };
        }
      }
    }

    // No match found, return fallback
    logger.info("No intent matched, returning fallback response");
    return {
      reply: fallbackResponse,
      timestamp: new Date(),
      confidence: 0,
    };
  }

  /**
   * Route query to external application's chatbot
   */
  private async routeToApp(
    appName: string,
    message: string,
    request?: ChatRequest,
  ): Promise<ChatResponse> {
    try {
      logger.info(`Routing to ${appName} via pattern match`);

      const response = await appRouterService.queryApp(
        appName,
        message,
        request?.userId,
        request?.context,
      );

      if (response.success) {
        return {
          reply: response.reply,
          timestamp: new Date(),
          confidence: response.confidence || 0.9,
        };
      } else {
        return {
          reply: response.reply,
          timestamp: new Date(),
          confidence: 0,
        };
      }
    } catch (error) {
      logger.error(`Error routing to ${appName}:`, error);
      return {
        reply: `I encountered an error while connecting to ${appName}. Please try again later.`,
        timestamp: new Date(),
        confidence: 0,
      };
    }
  }

  /**
   * Handle queries that require external app data (legacy - direct queries)
   */
  private async handleExternalQuery(queryType: string): Promise<ChatResponse> {
    try {
      logger.info(`Handling external query: ${queryType}`);

      switch (queryType) {
        case "chemical_tracker_wells": {
          const result = await chemicalTrackerService.getWells({ limit: 10 });
          if (result.success && result.data) {
            return {
              reply: chemicalTrackerService.formatWellsResponse(
                result.data.wells,
                result.data.total,
              ),
              timestamp: new Date(),
              confidence: 1.0,
            };
          } else {
            return this.getExternalAppErrorResponse(result.error);
          }
        }

        case "chemical_tracker_analytics": {
          const result = await chemicalTrackerService.getAnalytics();
          if (result.success && result.data) {
            return {
              reply: chemicalTrackerService.formatAnalyticsResponse(
                result.data,
              ),
              timestamp: new Date(),
              confidence: 1.0,
            };
          } else {
            return this.getExternalAppErrorResponse(result.error);
          }
        }

        case "chemical_tracker_clients": {
          const result = await chemicalTrackerService.getClients();
          if (result.success && result.data) {
            return {
              reply: chemicalTrackerService.formatClientsResponse(
                result.data.clients,
                result.data.total,
              ),
              timestamp: new Date(),
              confidence: 1.0,
            };
          } else {
            return this.getExternalAppErrorResponse(result.error);
          }
        }

        default:
          logger.warn(`Unknown external query type: ${queryType}`);
          return {
            reply: "I'm not sure how to handle that query yet.",
            timestamp: new Date(),
            confidence: 0,
          };
      }
    } catch (error) {
      logger.error("Error handling external query:", error);
      return {
        reply:
          "I encountered an error while fetching data from the external application. Please try again later.",
        timestamp: new Date(),
        confidence: 0,
      };
    }
  }

  /**
   * Format user-friendly error messages
   */
  private getExternalAppErrorResponse(error?: {
    code: string;
    message: string;
  }): ChatResponse {
    const errorMessages: Record<string, string> = {
      UNAUTHORIZED:
        "I couldn't access the Chemical Tracker. Please make sure you're logged in.",
      FORBIDDEN:
        "You don't have permission to access this data in Chemical Tracker.",
      NOT_FOUND: "The requested data was not found in Chemical Tracker.",
      NETWORK_ERROR:
        "I couldn't connect to Chemical Tracker. The service might be temporarily unavailable.",
      RATE_LIMIT_EXCEEDED:
        "Too many requests to Chemical Tracker. Please try again in a moment.",
      EXTERNAL_APP_ERROR: `Chemical Tracker returned an error: ${error?.message || "Unknown error"}`,
    };

    const message =
      errorMessages[error?.code || "NETWORK_ERROR"] ||
      "I encountered an issue while fetching data from Chemical Tracker.";

    return {
      reply: message,
      timestamp: new Date(),
      confidence: 0,
    };
  }
}

/**
 * HybridChatProvider
 * Step A: Static pattern matching (HardcodedChatProvider — unchanged)
 * Step B: FileBank lookup (case-insensitive substring match on name/description/tags)
 * Step C: Claude tool-use routing over active ExternalApps (ENABLE_AI_FALLBACK=true only)
 */
class HybridChatProvider implements ChatProvider {
  private hardcodedProvider: HardcodedChatProvider;
  private aiEnabled: boolean;
  private claudeClient?: Anthropic;

  constructor() {
    this.hardcodedProvider = new HardcodedChatProvider();
    this.aiEnabled = env.enableAiFallback && !!env.anthropicApiKey;

    if (this.aiEnabled) {
      this.claudeClient = new Anthropic({ apiKey: env.anthropicApiKey });
      logger.info("Hybrid Chat Provider: Claude tool-use routing enabled");
    } else {
      logger.info(
        "Hybrid Chat Provider: Claude routing disabled (pattern-matching + file bank only)",
      );
    }
  }

  async getResponse(
    message: string,
    request?: ChatRequest,
  ): Promise<ChatResponse> {
    // ── Step A: Static intent matching (zero cost) ─────────────────
    const patternResponse = await this.hardcodedProvider.getResponse(
      message,
      request,
    );

    if (patternResponse.confidence && patternResponse.confidence > 0) {
      logger.info(
        `Pattern match successful (confidence: ${patternResponse.confidence})`,
      );
      return patternResponse;
    }

    // ── Step B: FileBank lookup ────────────────────────────────────
    const fileBankResponse = await this.lookupFileBank(message);
    if (fileBankResponse) {
      return fileBankResponse;
    }

    // ── Step C: Claude tool-use routing ────────────────────────────
    if (this.aiEnabled) {
      logger.info("No static/file match — trying Claude tool-use routing");
      return await this.routeWithClaude(message, request);
    }

    // No match and AI disabled
    logger.info("No match and AI disabled, returning fallback");
    return patternResponse; // confidence 0, fallback message
  }

  /**
   * Query the FileBank collection for a case-insensitive substring match
   * against originalName, description, or any tag.
   */
  private async lookupFileBank(message: string): Promise<ChatResponse | null> {
    try {
      const normalized = message.toLowerCase();
      const files = await FileBank.find();

      for (const file of files) {
        const nameMatch = file.originalName?.toLowerCase().includes(normalized) ?? false;
        const descMatch = file.description?.toLowerCase().includes(normalized) ?? false;
        const tagMatch = file.tags.some(
          (tag) =>
            normalized.includes(tag.toLowerCase()) ||
            tag.toLowerCase().includes(normalized),
        );

        if (nameMatch || descMatch || tagMatch) {
          logger.info(`FileBank match: "${file.originalName}"`);
          return {
            reply: `I found a file that may help you: **${file.originalName}**\n\nYou can download it here: ${file.downloadUrl}`,
            timestamp: new Date(),
            confidence: 0.85,
          };
        }
      }
    } catch (error) {
      logger.error("Error querying FileBank:", error);
    }
    return null;
  }

  /**
   * Call Claude claude-opus-4-5 with one tool per active ExternalApp that has chatbotApiUrl set.
   * If Claude picks a tool → forward to appRouterService.queryApp().
   * If Claude returns text → return it directly.
   */
  private async routeWithClaude(
    message: string,
    request?: ChatRequest,
  ): Promise<ChatResponse> {
    try {
      const activeApps = await ExternalApp.find({
        isActive: true,
        chatbotApiUrl: { $exists: true, $ne: "" },
      });

      const tools: Anthropic.Tool[] = activeApps.map((app) => ({
        name: slugify(app.name),
        description: app.description,
        input_schema: {
          type: "object" as const,
          properties: {
            message: {
              type: "string",
              description: "The user question to forward to this application",
            },
          },
          required: ["message"],
        },
      }));

      const client = this.claudeClient!;

      const claudeResponse = await client.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 1024,
        system:
          "You are the internal assistant for Odessa Separator Inc. (OSI). " +
          "You have access to several internal applications as tools. " +
          "When the user's question is about data that lives in one of those applications, " +
          "call the appropriate tool. " +
          "If the question is general OSI company knowledge (services, mission, business units, departments), " +
          "answer it directly without calling any tool. " +
          "Never guess application data — always use the tool.",
        tools,
        messages: [{ role: "user", content: message }],
      });

      // Check for tool_use block
      const toolUseBlock = claudeResponse.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      if (toolUseBlock) {
        const rawInput = toolUseBlock.input as Record<string, unknown>;
        const toolMessage = typeof rawInput?.message === "string" ? rawInput.message : message;
        const matchedApp = activeApps.find(
          (app) => slugify(app.name) === toolUseBlock.name,
        );

        if (matchedApp) {
          logger.info(
            `Claude routed to app: "${matchedApp.name}" (tool: ${toolUseBlock.name})`,
          );
          const appResponse = await appRouterService.queryApp(
            matchedApp.name,
            toolMessage,
            request?.userId,
            request?.context,
          );
          return {
            reply: appResponse.reply,
            timestamp: new Date(),
            confidence: appResponse.success ? 0.9 : 0,
          };
        } else {
          logger.warn(
            `Claude selected tool "${toolUseBlock.name}" but no matching app was found`,
          );
        }
      }

      // Check for text block (direct answer, no tool call)
      const textBlock = claudeResponse.content.find(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );

      if (textBlock) {
        logger.info("Claude returned direct text response (no tool call)");
        return {
          reply: textBlock.text,
          timestamp: new Date(),
          confidence: 0.8,
        };
      }

      // Unexpected response shape — return fallback
      logger.warn("Claude returned no usable block");
      return {
        reply: fallbackResponse,
        timestamp: new Date(),
        confidence: 0,
      };
    } catch (error) {
      logger.error("Error calling Claude API:", error);
      return {
        reply:
          "I'm having trouble connecting to my AI routing system. Please try again.",
        timestamp: new Date(),
        confidence: 0,
      };
    }
  }
}

/**
 * ChatbotService
 * Main service that orchestrates chatbot functionality.
 * Uses hybrid approach: pattern matching + AI fallback
 */
class ChatbotService {
  private provider: ChatProvider;

  constructor(provider?: ChatProvider) {
    // Default to hybrid provider (pattern matching + AI fallback)
    this.provider = provider || new HybridChatProvider();
  }

  async processMessage(request: ChatRequest): Promise<ChatResponse> {
    try {
      const message = request.message;
      if (!message || message.trim().length === 0) {
        return {
          reply: "Please ask me a question about OSI.",
          timestamp: new Date(),
          confidence: 1.0,
        };
      }

      const response = await this.provider.getResponse(message, request);
      return response;
    } catch (error) {
      logger.error("Error processing chatbot message:", error);
      throw error;
    }
  }

  // Method to switch provider (useful for future AI integration)
  setProvider(provider: ChatProvider): void {
    this.provider = provider;
  }
}

export const chatbotService = new ChatbotService();
export { HardcodedChatProvider, HybridChatProvider };
