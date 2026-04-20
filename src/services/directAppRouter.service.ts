import { intents } from "../config/intents";
import { appRouterService } from "./appRouter.service";
import { ChatResponse } from "../types/chatbot.types";
import logger from "../utils/logger";

/**
 * tryDirectAppRoute
 *
 * Checks the user message against ROUTE:* patterns in intents.ts and, if
 * matched, calls the target app's chatbot API directly. This runs BEFORE
 * n8n so that known app queries bypass the webhook entirely — faster,
 * cheaper, and more reliable.
 *
 * Returns a ChatResponse if an app handled the query, or null to let the
 * next provider (n8n / hybrid) take over.
 */
export async function tryDirectAppRoute(
  message: string,
  userId?: string,
  context?: Record<string, unknown>,
): Promise<ChatResponse | null> {
  for (const intent of intents) {
    if (!intent.response.startsWith("ROUTE:")) continue;

    for (const pattern of intent.patterns) {
      if (pattern instanceof RegExp && pattern.test(message)) {
        const appName = intent.response.replace("ROUTE:", "").trim();
        logger.info(`DirectAppRouter: pattern matched → routing to ${appName}`);

        try {
          const result = await appRouterService.queryApp(
            appName,
            message,
            userId,
            context,
          );

          if (result.success) {
            return {
              reply: result.reply,
              timestamp: new Date(),
              confidence: result.confidence || 0.9,
            };
          }

          // If the app isn't configured yet, fall through to n8n
          if (
            result.error?.code === "CHATBOT_NOT_CONFIGURED" ||
            result.error?.code === "APP_NOT_FOUND"
          ) {
            logger.warn(
              `DirectAppRouter: ${appName} not configured, falling through to n8n`,
            );
            return null;
          }

          // For other errors (connection, inactive), return the error to the user
          return {
            reply: result.reply,
            timestamp: new Date(),
            confidence: 0,
          };
        } catch (error) {
          logger.error(`DirectAppRouter: error routing to ${appName}`, error);
          return null;
        }
      }
    }
  }

  return null;
}
