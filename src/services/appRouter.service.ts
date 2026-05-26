import { ExternalAppClientFactory } from "./externalApp.client";
import ExternalApp from "../models/App.model";
import logger from "../utils/logger";
import { env } from "../config/env";

/**
 * Standard chatbot query request to external apps
 */
interface ChatbotQueryRequest {
  message: string;
  userId?: string;
  sessionId?: string;
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
   * Get service-to-service API key for a specific app
   */
  private getAppApiKey(appName: string): string | undefined {
    const apiKeyMap: Record<string, string | undefined> = {
      "Chemical Tracker": env.chemtrackerChatbotApiKey,
      "Designer": env.designerChatbotApiKey,
      "OSI Pump Pro": env.pumpTrackerChatbotApiKey,
      "Pump Tracker": env.pumpTrackerChatbotApiKey,
    };

    return apiKeyMap[appName];
  }

  /**
   * Normalize legacy app URLs for chatbot calls.
   * Some launch URLs include SSO paths like /auth/microsoft, which must not be
   * part of chatbot API base URLs.
   */
  private normalizeChatbotBaseUrl(rawUrl: string): string {
    if (!rawUrl) return rawUrl;

    const normalized = rawUrl
      .replace(/\/auth\/microsoft\/?$/i, "")
      .replace(/\/$/, "");

    return normalized;
  }

  private resolveChatbotTarget(
    rawUrl: string,
    appName: string,
  ): { baseUrl: string; endpoint: string; mode: "base" | "full" } {
    const normalizedUrl = this.normalizeChatbotBaseUrl(rawUrl);

    try {
      const parsed = new URL(normalizedUrl);
      const path = parsed.pathname.toLowerCase();
      const isFullEndpoint =
        path.endsWith("/chatbot/query") ||
        path.includes("/webhook/") ||
        path.includes("/webhook-test/");

      if (isFullEndpoint) {
        return { baseUrl: normalizedUrl, endpoint: "", mode: "full" };
      }
    } catch {
      // Fall through to legacy base URL behavior.
    }

    return {
      baseUrl: normalizedUrl,
      endpoint: this.getChatbotEndpoint(appName),
      mode: "base",
    };
  }

  private getAppNameCandidates(appName: string): string[] {
    const aliases: Record<string, string[]> = {
      "OSI Pump Pro": ["OSI Pump Pro", "Pump Tracker", "OSI Pump Tracker"],
      "Pump Tracker": ["Pump Tracker", "OSI Pump Pro", "OSI Pump Tracker"],
      Designer: ["Designer", "OSI Designer"],
      "Chemical Tracker": ["Chemical Tracker", "Chem Tracker"],
    };

    return aliases[appName] || [appName];
  }

  /**
   * Get the chatbot endpoint path for a specific app
   * Each app may have its own API prefix convention
   *
   * NOTE: The base URL already includes the API prefix (e.g., /api-chemtracker)
   * So we only need the relative path from there
   */
  private getChatbotEndpoint(appName: string): string {
    // Map app names to their chatbot endpoints (relative to base URL)
    const endpointMap: Record<string, string> = {
      "Chemical Tracker": "/chatbot/query",
      "OSI Pump Pro": "/chatbot/query",
      Designer: "/chatbot/query",
      "Gas Separator": "/chatbot/query",
    };

    // Return app-specific endpoint or default to generic endpoint
    return endpointMap[appName] || "/chatbot/query";
  }

  /**
   * Send a query to a specific app's chatbot endpoint
   */
  async queryApp(
    appName: string,
    message: string,
    userId?: string,
    context?: Record<string, any>,
    sessionId?: string,
  ): Promise<ChatbotQueryResponse> {
    const startedAt = Date.now();
    try {
      // Get app from database to get its URL
      const app = await ExternalApp.findOne({
        name: { $in: this.getAppNameCandidates(appName) },
      });

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

      // Require dedicated chatbot API URL — do not fall back to launch URL
      if (!app.chatbotApiUrl) {
        logger.warn(`${appName} has no chatbotApiUrl configured`);
        return {
          success: false,
          reply: `The chatbot integration for ${appName} hasn't been implemented yet. Please contact your administrator to set it up.`,
          timestamp: new Date().toISOString(),
          error: {
            code: "CHATBOT_NOT_CONFIGURED",
            message: `Application ${appName} has no chatbotApiUrl configured`,
          },
        };
      }

      const chatbotTarget = this.resolveChatbotTarget(app.chatbotApiUrl, appName);
      const appApiKey = this.getAppApiKey(appName);

      logger.info(
        `[${appName}] Connecting → mode: "${chatbotTarget.mode}", baseUrl: "${chatbotTarget.baseUrl}", endpoint: "${chatbotTarget.endpoint || "(full URL)"}", apiKey: ${appApiKey ? "present (" + appApiKey.substring(0, 8) + "...)" : "MISSING"}`,
      );

      // Create client for this app
      const client = ExternalAppClientFactory.getClient(
        appName,
        chatbotTarget.baseUrl,
        appApiKey,
        env.chatbotConnectorTimeoutMs,
      );

      // Send query to app's chatbot endpoint
      logger.info(
        `Routing query to ${appName}: "${message.substring(0, 50)}..." (${chatbotTarget.mode}: ${chatbotTarget.baseUrl}${chatbotTarget.endpoint})`,
      );

      const request: ChatbotQueryRequest = {
        message,
        userId,
        sessionId,
        context,
      };

      let response = await client.post<ChatbotQueryResponse>(
        chatbotTarget.endpoint,
        request,
      );
      if (!response.success && response.error?.code === "NETWORK_ERROR") {
        logger.warn(`${appName} network error; retrying once`);
        response = await client.post<ChatbotQueryResponse>(
          chatbotTarget.endpoint,
          request,
        );
      }

      // Support two response shapes from external apps:
      // 1) Wrapped: { success, data: { success, reply, ... } }
      // 2) Direct:  { success, reply, ... }
      const wrappedResponse = response as {
        success?: boolean;
        data?: ChatbotQueryResponse;
        error?: { code: string; message: string };
      };
      const directResponse = response as unknown as ChatbotQueryResponse;

      if (wrappedResponse.success && wrappedResponse.data) {
        logger.info(
          `${appName} responded successfully (wrapped format, ${Date.now() - startedAt}ms)`,
        );
        return wrappedResponse.data;
      }

      if (directResponse.success && directResponse.reply) {
        logger.info(
          `${appName} responded successfully (direct format, ${Date.now() - startedAt}ms)`,
        );
        return directResponse;
      }

      const errorCode =
        wrappedResponse.error?.code || directResponse.error?.code || "UNKNOWN_ERROR";
      const errorMessage =
        wrappedResponse.error?.message ||
        directResponse.error?.message ||
        "No error details returned by the configured chatbot endpoint.";
      logger.error(
        `${appName} returned error from ${chatbotTarget.mode} endpoint ${chatbotTarget.baseUrl}${chatbotTarget.endpoint}: ${errorCode} - ${errorMessage}`,
      );
      return {
        success: false,
        reply: `${appName} could not answer through its configured chatbot endpoint. Connector error: ${errorCode}. ${errorMessage}`,
        timestamp: new Date().toISOString(),
        error: {
          code: errorCode,
          message: errorMessage,
        },
      };
    } catch (error: any) {
      logger.error(`Error querying ${appName} after ${Date.now() - startedAt}ms:`, error);
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
