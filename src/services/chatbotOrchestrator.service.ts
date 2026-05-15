import OpenAI from "openai";
import { ChatRequest, ChatResponse } from "../types/chatbot.types";
import { HardcodedChatProvider } from "./chatbot.service";
import { appRouterService } from "./appRouter.service";
import { documentLookupService } from "./documentLookup.service";
import { documentSearchService } from "./documentSearch.service";
import { n8nWebhookProvider } from "./n8nWebhook.service";
import { oneDriveService } from "./oneDrive.service";
import {
  appendConversationTurns,
  getConversationHistory,
  ContextTurn,
} from "./conversation.service";
import { env } from "../config/env";
import logger from "../utils/logger";

type RouteTarget =
  | "file_bank"
  | "onedrive"
  | "chemical_tracker"
  | "designer"
  | "pump_tracker"
  | "general"
  | "clarify";

interface RouteDecision {
  route: RouteTarget;
  query: string;
  confidence: number;
}

const APP_ROUTES: Record<Exclude<RouteTarget, "file_bank" | "onedrive" | "general" | "clarify">, string> = {
  chemical_tracker: "Chemical Tracker",
  designer: "Designer",
  pump_tracker: "OSI Pump Pro",
};

class ChatbotOrchestrator {
  private staticProvider = new HardcodedChatProvider();
  private openai?: OpenAI;

  constructor() {
    if (env.openaiApiKey) {
      this.openai = new OpenAI({ apiKey: env.openaiApiKey });
    }
  }

  async processMessage(request: ChatRequest): Promise<ChatResponse> {
    const message = request.message?.trim();
    if (!message) {
      return {
        reply: "Please ask me a question about OSI.",
        timestamp: new Date(),
        confidence: 1,
        source: "static",
      };
    }

    const sessionId = request.sessionId || `default-${request.userId}`;
    const storedHistory =
      request.userId && request.userId !== "anonymous"
        ? await getConversationHistory(request.userId, sessionId, 12)
        : [];
    const clientHistory = request.context?.history || [];
    const history = [...storedHistory, ...clientHistory].slice(-12);
    const startedAt = Date.now();

    try {
      const response = await this.routeMessage(message, {
        ...request,
        sessionId,
        context: { history },
      });

      if (request.userId && request.userId !== "anonymous") {
        await appendConversationTurns(request.userId, sessionId, [
          { role: "user", content: message },
          { role: "assistant", content: response.reply },
        ]);
      }

      logger.info(
        `Chatbot route=${response.routedTo || response.source || "unknown"} confidence=${response.confidence ?? 0} latency=${Date.now() - startedAt}ms`,
      );

      return response;
    } catch (error) {
      logger.error("Chatbot orchestration failed:", error);
      return {
        reply: "I'm having trouble processing that request. Please try again.",
        timestamp: new Date(),
        confidence: 0,
        source: "error",
        routedTo: "error",
      };
    }
  }

  async getHistory(userId: string, sessionId: string): Promise<ContextTurn[]> {
    return getConversationHistory(userId, sessionId, 50);
  }

  private async routeMessage(
    message: string,
    request: ChatRequest,
  ): Promise<ChatResponse> {
    const staticDocument = documentLookupService.lookup(message);
    if (staticDocument) {
      return { ...staticDocument, source: "file_bank", routedTo: "static_documents" };
    }

    if (documentSearchService.isDocumentRequest(message)) {
      const localDocs = await documentSearchService.search(message);
      if (localDocs.length) {
        const response = documentSearchService.toChatResponse(localDocs);
        if (response) return response;
      }

      await oneDriveService.search(message);
      const oneDriveDocs = await documentSearchService.search(message);
      const response = documentSearchService.toChatResponse(oneDriveDocs);
      if (response) return response;
    }

    const deterministicRoute = this.getDeterministicRoute(message);
    if (
      deterministicRoute.route === "chemical_tracker" ||
      deterministicRoute.route === "designer" ||
      deterministicRoute.route === "pump_tracker"
    ) {
      return this.routeToApp(deterministicRoute, message, request);
    }

    const staticResponse = await this.staticProvider.getResponse(message, request);
    if ((staticResponse.confidence || 0) > 0) {
      return { ...staticResponse, source: "static", routedTo: "static" };
    }

    const aiDecision = await this.getAiRoute(message, request.context?.history || []);
    if (
      aiDecision.route === "file_bank" ||
      aiDecision.route === "onedrive"
    ) {
      await oneDriveService.search(aiDecision.query);
      const docs = await documentSearchService.search(aiDecision.query);
      const response = documentSearchService.toChatResponse(docs);
      if (response) return response;

      return {
        reply:
          "I couldn't find a matching document in the File Bank or OneDrive index. Try a filename, customer name, well name, or document number.",
        timestamp: new Date(),
        confidence: 0.4,
        source: "file_bank",
        routedTo: "documents",
      };
    }

    if (
      aiDecision.route === "chemical_tracker" ||
      aiDecision.route === "designer" ||
      aiDecision.route === "pump_tracker"
    ) {
      if (aiDecision.confidence < 0.55) {
        return this.clarifyResponse();
      }
      return this.routeToApp(aiDecision, message, request);
    }

    if (aiDecision.route === "general") {
      return this.generalAnswer(message, request.context?.history || []);
    }

    if (env.enableN8nChatbot) {
      const response = await n8nWebhookProvider.getResponse(message, request);
      return { ...response, source: "n8n", routedTo: "n8n" };
    }

    return this.clarifyResponse();
  }

  private getDeterministicRoute(message: string): RouteDecision {
    const msg = message.toLowerCase();

    if (
      /\b(chem|chemical)\s*-?\s*tracker\b/.test(msg) ||
      /\b(wells?|clients?|chemicals?|analytics)\b.*\b(chem|chemical)\b/.test(msg)
    ) {
      return { route: "chemical_tracker", query: message, confidence: 0.95 };
    }

    if (
      /\bdesigner\b/.test(msg) ||
      /\b(proposals?|sales\s*orders?|wellbore|tally|designs?|simulation)\b/.test(msg)
    ) {
      return { route: "designer", query: message, confidence: 0.9 };
    }

    if (/\b(pump\s*-?\s*tracker|pump\s+pro|rod\s*pump|pump\s+performance|pumps?)\b/.test(msg)) {
      return { route: "pump_tracker", query: message, confidence: 0.9 };
    }

    return { route: "clarify", query: message, confidence: 0 };
  }

  private async getAiRoute(
    message: string,
    history: ContextTurn[],
  ): Promise<RouteDecision> {
    if (!this.openai || !env.enableAiFallback) {
      return { route: "clarify", query: message, confidence: 0 };
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model: env.chatbotAiRouterModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Route OSI assistant requests. Return only JSON with route, query, confidence. Routes: file_bank, onedrive, chemical_tracker, designer, pump_tracker, general, clarify. Use file_bank/onedrive for documents, PDFs, reports, invoices, proposals requested as files. Use chemical_tracker for wells, clients, chemicals, analytics. Use designer for proposals, sales orders, designs, tallies, simulations. Use pump_tracker for pump status, pump reports, pump performance.",
          },
          ...history.slice(-8).map((turn) => ({
            role: turn.role,
            content: turn.content,
          })),
          { role: "user", content: message },
        ],
      });

      const raw = completion.choices[0]?.message?.content || "{}";
      const parsed = JSON.parse(raw) as Partial<RouteDecision>;
      const route = parsed.route || "clarify";
      const validRoutes: RouteTarget[] = [
        "file_bank",
        "onedrive",
        "chemical_tracker",
        "designer",
        "pump_tracker",
        "general",
        "clarify",
      ];

      if (!validRoutes.includes(route)) {
        return { route: "clarify", query: message, confidence: 0 };
      }

      return {
        route,
        query: parsed.query || message,
        confidence:
          typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
      };
    } catch (error) {
      logger.warn("AI route classification failed:", error);
      return { route: "clarify", query: message, confidence: 0 };
    }
  }

  private async routeToApp(
    decision: RouteDecision,
    message: string,
    request: ChatRequest,
  ): Promise<ChatResponse> {
    const appName = APP_ROUTES[
      decision.route as keyof typeof APP_ROUTES
    ];
    const result = await appRouterService.queryApp(
      appName,
      decision.query || message,
      request.userId,
      request.context,
      request.sessionId,
    );

    return {
      reply: result.reply,
      timestamp: new Date(result.timestamp || Date.now()),
      confidence: result.success ? result.confidence || decision.confidence : 0,
      source: result.success ? "app" : "error",
      routedTo: appName,
    };
  }

  private async generalAnswer(
    message: string,
    history: ContextTurn[],
  ): Promise<ChatResponse> {
    if (!this.openai || !env.enableAiFallback) {
      return this.clarifyResponse();
    }

    try {
      const completion = await this.openai.chat.completions.create({
        model: env.openaiModel || "gpt-4o-mini",
        temperature: 0.4,
        max_tokens: 500,
        messages: [
          {
            role: "system",
            content:
              "You are the OSI Assistant for Odessa Separator Inc. Answer concise general questions about OSI. Do not invent app data; say you can route app/data questions to Designer, Chemical Tracker, Pump Tracker, File Bank, or OneDrive.",
          },
          ...history.slice(-8).map((turn) => ({
            role: turn.role,
            content: turn.content,
          })),
          { role: "user", content: message },
        ],
      });

      return {
        reply:
          completion.choices[0]?.message?.content?.trim() ||
          "I can help with OSI information, documents, and connected applications.",
        timestamp: new Date(),
        confidence: 0.75,
        source: "ai",
        routedTo: "general",
      };
    } catch (error) {
      logger.warn("General AI answer failed:", error);
      return this.clarifyResponse();
    }
  }

  private clarifyResponse(): ChatResponse {
    return {
      reply:
        "I can help with OSI documents, OSI Designer, Chemical Tracker, Pump Tracker, or general OSI information. Which source should I check?",
      timestamp: new Date(),
      confidence: 0.3,
      source: "ai",
      routedTo: "clarify",
    };
  }
}

export const chatbotOrchestrator = new ChatbotOrchestrator();
