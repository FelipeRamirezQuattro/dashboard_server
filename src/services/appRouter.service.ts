import { ExternalAppClientFactory } from "./externalApp.client";
import ExternalApp from "../models/App.model";
import logger from "../utils/logger";

/**
 * Standard chatbot query request to external apps
 */
interface ChatbotQueryRequest {
  message: string;
  userId?: string;
  context?: Record<string, any>;
}

/**
 * Standard chatbot query response from external apps
 */
interface ChatbotQueryResponse {
  success: boolean;
  reply: string;
  timestamp: string;
  confidence?: number;
  metadata?: {
    queryType?: string;
    resultsCount?: number;
    processingMethod?: "pattern_match" | "ai_fallback";
  };
  error?: {
    code: string;
    message: string;
  };
}

/**
 * AppRouterService
 * Routes user queries to the appropriate external application's chatbot
 */
class AppRouterService {
  /**
   * Get the chatbot endpoint path for a specific app
   * Each app may have its own API prefix convention
   */
  private getChatbotEndpoint(appName: string): string {
    // Map app names to their specific chatbot endpoints
    const endpointMap: Record<string, string> = {
      "Chemical Tracker": "/api-chemtracker/chatbot/query",
      "OSI Pump Pro": "/api-pumppro/chatbot/query",
      Designer: "/api-designer/chatbot/query",
      "Gas Separator": "/api-gassep/chatbot/query",
    };

    // Return app-specific endpoint or default to generic endpoint
    return endpointMap[appName] || "/api/chatbot/query";
  }

  /**
   * Send a query to a specific app's chatbot endpoint
   */
  async queryApp(
    appName: string,
    message: string,
    userId?: string,
  ): Promise<ChatbotQueryResponse> {
    try {
      // Get app from database to get its URL
      const app = await ExternalApp.findOne({ name: appName });

      if (!app) {
        return {
          success: false,
          reply: `I couldn't find the ${appName} application.`,
          timestamp: new Date().toISOString(),
          error: {
            code: "APP_NOT_FOUND",
            message: `Application ${appName} not found in system`,
          },
        };
      }

      if (!app.isActive) {
        return {
          success: false,
          reply: `${appName} is currently unavailable.`,
          timestamp: new Date().toISOString(),
          error: {
            code: "APP_INACTIVE",
            message: `Application ${appName} is not active`,
          },
        };
      }

      // Create client for this app
      const client = ExternalAppClientFactory.getClient(appName, app.url);

      // Send query to app's chatbot endpoint
      logger.info(
        `Routing query to ${appName}: "${message.substring(0, 50)}..."`,
      );

      const request: ChatbotQueryRequest = {
        message,
        userId,
      };

      // Get the chatbot endpoint for this specific app
      const chatbotEndpoint = this.getChatbotEndpoint(appName);

      const response = await client.post<ChatbotQueryResponse>(
        chatbotEndpoint,
        request,
      );

      if (response.success && response.data) {
        logger.info(`${appName} responded successfully`);
        return response.data;
      } else {
        logger.error(`${appName} returned error:`, response.error);
        return {
          success: false,
          reply: `${appName} encountered an error processing your request.`,
          timestamp: new Date().toISOString(),
          error: response.error,
        };
      }
    } catch (error: any) {
      logger.error(`Error querying ${appName}:`, error);
      return {
        success: false,
        reply: `I couldn't connect to ${appName}. The service might be temporarily unavailable.`,
        timestamp: new Date().toISOString(),
        error: {
          code: "CONNECTION_ERROR",
          message: error.message,
        },
      };
    }
  }

  /**
   * Get list of available apps with their capabilities
   */
  async getAvailableApps(): Promise<string[]> {
    const apps = await ExternalApp.find({ isActive: true }).select("name");
    return apps.map((app) => app.name);
  }
}

export const appRouterService = new AppRouterService();
