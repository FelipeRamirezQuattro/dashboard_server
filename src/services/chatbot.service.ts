import { ChatProvider, ChatResponse } from "../types/chatbot.types";
import { intents, fallbackResponse } from "../config/intents";
import logger from "../utils/logger";

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
}

/**
 * AIChatProvider (Future Implementation)
 * This will integrate with Azure OpenAI, OpenAI API, or internal LLM
 */
class AIChatProvider implements ChatProvider {
  async getResponse(_message: string): Promise<ChatResponse> {
    // TODO: Implement AI service integration
    // Example: Call Azure OpenAI API
    // const completion = await openai.chat.completions.create({...});
    throw new Error("AI Chat Provider not yet implemented");
  }
}

/**
 * ChatbotService
 * Main service that orchestrates chatbot functionality.
 * Uses dependency injection to allow switching between providers.
 */
class ChatbotService {
  private provider: ChatProvider;

  constructor(provider?: ChatProvider) {
    // Default to hardcoded provider, but allow injection for testing/future AI
    this.provider = provider || new HardcodedChatProvider();
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
export { HardcodedChatProvider, AIChatProvider };
