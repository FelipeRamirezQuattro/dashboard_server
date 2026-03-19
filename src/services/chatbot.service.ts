import { ChatProvider, ChatResponse } from "../types/chatbot.types";
import { intents, fallbackResponse } from "../config/intents";
import logger from "../utils/logger";
import { chemicalTrackerService } from "./chemicalTracker.service";
import { AIChatProvider } from "./ai.provider";
import { env } from "../config/env";

/**
 * HardcodedChatProvider
 * Provides chatbot responses based on hardcoded intents and pattern matching.
 * This will be replaced with AIChatProvider in the future.
 */
class HardcodedChatProvider implements ChatProvider {
  async getResponse(message: string): Promise<ChatResponse> {
    const normalizedMessage = message.trim().toLowerCase();

    // Try to match against patterns
    for (const intent of intents) {
      // Check regex patterns
      for (const pattern of intent.patterns) {
        if (pattern instanceof RegExp && pattern.test(message)) {
          logger.info(`Intent matched: ${pattern}`);

          // Check if this is an external app query
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

          // Check if this is an external app query
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
   * Handle queries that require external app data
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
 * Uses pattern matching first (fast, free), falls back to AI (flexible, costs money)
 * Best of both worlds approach
 */
class HybridChatProvider implements ChatProvider {
  private hardcodedProvider: HardcodedChatProvider;
  private aiProvider: AIChatProvider | null;
  private aiEnabled: boolean;

  constructor() {
    this.hardcodedProvider = new HardcodedChatProvider();
    this.aiProvider = null;
    this.aiEnabled = env.enableAiFallback && !!env.openaiApiKey;

    if (this.aiEnabled) {
      this.aiProvider = new AIChatProvider();
      if (this.aiProvider.isReady()) {
        logger.info("Hybrid Chat Provider: AI fallback enabled");
      } else {
        logger.warn(
          "Hybrid Chat Provider: AI fallback disabled (initialization failed)",
        );
        this.aiEnabled = false;
      }
    } else {
      logger.info(
        "Hybrid Chat Provider: AI fallback disabled (pattern-matching only)",
      );
    }
  }

  async getResponse(message: string): Promise<ChatResponse> {
    // Step 1: Try pattern matching first (fast, no cost)
    const patternResponse = await this.hardcodedProvider.getResponse(message);

    // If pattern matching found a match (confidence > 0), use it
    if (patternResponse.confidence && patternResponse.confidence > 0) {
      logger.info(
        `Pattern match successful (confidence: ${patternResponse.confidence})`,
      );
      return patternResponse;
    }

    // Step 2: If no pattern match, try AI fallback (if enabled)
    if (this.aiEnabled && this.aiProvider) {
      logger.info("No pattern match, using AI fallback");
      return await this.aiProvider.getResponse(message);
    }

    // Step 3: No pattern match and AI disabled, return fallback
    logger.info("No pattern match and AI disabled, returning fallback");
    return patternResponse; // Already has confidence 0 and fallback message
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

  async processMessage(message: string): Promise<ChatResponse> {
    try {
      if (!message || message.trim().length === 0) {
        return {
          reply: "Please ask me a question about OSI.",
          timestamp: new Date(),
          confidence: 1.0,
        };
      }

      const response = await this.provider.getResponse(message);
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
