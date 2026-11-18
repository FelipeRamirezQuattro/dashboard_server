import mongoose from "mongoose";
import { ExternalAppClientFactory } from "./externalApp.client";
import ExternalApp from "../models/App.model";
import logger from "../utils/logger";
import { env } from "../config/env";
import {
  ExternalChatbotRequest,
  ExternalChatbotResponse,
  externalChatbotRequestSchema,
  externalChatbotResponseSchema,
  wrappedExternalChatbotResponseSchema,
} from "../contracts/externalChatbot.contract";
import { recordChatbotAutomationAudit } from "./chatbotAutomationAudit.service";
import { checkUserAppAccess } from "./permissions.service";
import User from "../models/User.model";

/**
 * Standard chatbot query request to external apps
 */
type ChatbotQueryRequest = ExternalChatbotRequest;

/**
 * Standard chatbot query response from external apps
 */
type ChatbotQueryResponse = ExternalChatbotResponse;

export const shouldRetryExternalChatbotRequest = (
  operationType: "read" | "write",
  errorCode?: string,
): boolean => {
  return operationType === "read" && errorCode === "NETWORK_ERROR";
};

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
      "Internal AI Assistant": env.internalAiAssistantChatbotApiKey,
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
      "Internal AI Assistant": ["Internal AI Assistant"],
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
      "Internal AI Assistant": "/chatbot/query",
      "OSI Pump Pro": "/chatbot/query",
      Designer: "/chatbot/query",
      "Gas Separator": "/chatbot/query",
    };

    // Return app-specific endpoint or default to generic endpoint
    return endpointMap[appName] || "/chatbot/query";
  }

  /**
   * Check the user may use the app. The role is read from the DB (never from
   * the client-supplied context) so it cannot be spoofed.
   */
  private async userCanAccessApp(
    userId: string | undefined,
    appId: string,
  ): Promise<boolean> {
    if (!userId || !mongoose.isValidObjectId(userId)) return false;
    const user = await User.findById(userId).select("role isActive").lean();
    if (!user || user.isActive === false) return false;
    return checkUserAppAccess(userId, user.role, appId);
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

      // Enforce application access for every chat path (auto-route, explicit
      // target, direct external_app). Fails closed when the user is unknown.
      const hasAccess = await this.userCanAccessApp(userId, app._id.toString());
      if (!hasAccess) {
        await recordChatbotAutomationAudit({
          userId,
          action: "CHAT_APP_AUTHZ_DENIED",
          target: app.name,
          metadata: {
            requestId: context?.requestId,
            appName: app.name,
            route: context?.routeMetadata?.route,
          },
        });
        return {
          success: false,
          reply: `You don't have access to ${appName}. Please contact your administrator.`,
          timestamp: new Date().toISOString(),
          error: {
            code: "APP_ACCESS_DENIED",
            message: `User is not authorized to use ${appName}`,
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
        `[${appName}] Connecting → mode: "${chatbotTarget.mode}", baseUrl: "${chatbotTarget.baseUrl}", endpoint: "${chatbotTarget.endpoint || "(full URL)"}", apiKey: ${appApiKey ? "present" : "MISSING"}`,
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
        `Routing query to ${appName} (${chatbotTarget.mode}: ${chatbotTarget.baseUrl}${chatbotTarget.endpoint})`,
      );

      const request = externalChatbotRequestSchema.parse({
        message,
        userId,
        sessionId,
        context: {
          ...(context || {}),
          operationType: context?.operationType || "read",
        },
      });
      const operationType = request.context?.operationType || "read";

      let response = await client.post<unknown>(
        chatbotTarget.endpoint,
        request,
      );
      if (
        !response.success &&
        shouldRetryExternalChatbotRequest(operationType, response.error?.code)
      ) {
        logger.warn(`${appName} network error; retrying once`);
        response = await client.post<unknown>(
          chatbotTarget.endpoint,
          request,
        );
      }

      const parsedResponse = this.parseExternalResponse(
        appName,
        response,
        request,
        Date.now() - startedAt,
      );

      if (parsedResponse) {
        await recordChatbotAutomationAudit({
          userId,
          action: "CHAT_EXTERNAL_APP_QUERY",
          target: appName,
          metadata: {
            requestId: request.context?.requestId,
            appName,
            route: request.context?.routeMetadata?.route,
            matchedRule: request.context?.routeMetadata?.matchedRule,
            success: parsedResponse.success,
            latency: Date.now() - startedAt,
            operationType,
            sourceSystem: parsedResponse.metadata?.sourceSystem,
          },
        });
        return parsedResponse;
      }

      const wrappedResponse = wrappedExternalChatbotResponseSchema
        .partial()
        .safeParse(response);
      const directResponse = externalChatbotResponseSchema
        .partial()
        .safeParse(response);
      const errorCode =
        wrappedResponse.data?.error?.code ||
        directResponse.data?.error?.code ||
        "UNKNOWN_ERROR";
      const errorMessage =
        wrappedResponse.data?.error?.message ||
        directResponse.data?.error?.message ||
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

  private parseExternalResponse(
    appName: string,
    response: unknown,
    request: ChatbotQueryRequest,
    durationMs: number,
  ): ChatbotQueryResponse | null {
    const wrappedResponse = wrappedExternalChatbotResponseSchema.safeParse(response);
    if (wrappedResponse.success && wrappedResponse.data.success && wrappedResponse.data.data) {
      logger.info(
        `${appName} responded successfully (wrapped format, ${durationMs}ms)`,
      );
      return {
        ...wrappedResponse.data.data,
        metadata: {
          ...(wrappedResponse.data.data.metadata || {}),
          requestId:
            wrappedResponse.data.data.metadata?.requestId ||
            request.context?.requestId,
          durationMs:
            wrappedResponse.data.data.metadata?.durationMs || durationMs,
        },
      };
    }

    const directResponse = externalChatbotResponseSchema.safeParse(response);
    if (directResponse.success) {
      logger.info(
        `${appName} responded successfully (direct format, ${durationMs}ms)`,
      );
      return {
        ...directResponse.data,
        metadata: {
          ...(directResponse.data.metadata || {}),
          requestId:
            directResponse.data.metadata?.requestId || request.context?.requestId,
          durationMs: directResponse.data.metadata?.durationMs || durationMs,
        },
      };
    }

    recordChatbotAutomationAudit({
      userId: request.userId,
      action: "INTERNAL_AI_CONTRACT_ERROR",
      target: appName,
      metadata: {
        requestId: request.context?.requestId,
        appName,
        route: request.context?.routeMetadata?.route,
        wrappedIssues: wrappedResponse.success
          ? undefined
          : wrappedResponse.error.issues.map((issue) => issue.path.join(".")),
        directIssues: directResponse.success
          ? undefined
          : directResponse.error.issues.map((issue) => issue.path.join(".")),
      },
    });

    return null;
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
