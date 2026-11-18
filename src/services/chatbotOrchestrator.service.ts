import OpenAI from "openai";
import { ChatRequest, ChatResponse } from "../types/chatbot.types";
import { HardcodedChatProvider } from "./chatbot.service";
import { appRouterService } from "./appRouter.service";
import { documentSearchService } from "./documentSearch.service";
import { n8nWebhookProvider } from "./n8nWebhook.service";
import { oneDriveService } from "./oneDrive.service";
import { workflowBrainChatService } from "./workflowBrainChat.service";
import { answerRodPumpQuestion } from "./brain/rodPumpChat";
import {
  decideChatRoute,
  RoutePolicyDecision,
  RouteTarget,
} from "./chatbotRoutePolicy.service";
import { recordChatbotAutomationAudit } from "./chatbotAutomationAudit.service";
import { recordBrainAudit } from "./brainAudit.service";
import {
  asKnownRole,
  BRAIN_CHAT_ACCESS_DENIED_REPLY,
  BrainAccessError,
} from "./brain/access";
import {
  appendConversationTurns,
  clearConversationHistory,
  getConversationHistory,
  ContextTurn,
} from "./conversation.service";
import { env } from "../config/env";
import logger from "../utils/logger";

type RouteDecision = RoutePolicyDecision;

const APP_ROUTES: Record<Exclude<RouteTarget, "file_bank" | "onedrive" | "workflow_brain" | "rod_pump_failure" | "general" | "clarify">, string> = {
  chemical_tracker: "Chemical Tracker",
  designer: "Designer",
  internal_ai_assistant: "Internal AI Assistant",
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
        context: { ...(request.context || {}), history },
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

  async clearHistory(userId: string, sessionId: string): Promise<void> {
    await clearConversationHistory(userId, sessionId);
  }

  private async routeMessage(
    message: string,
    request: ChatRequest,
  ): Promise<ChatResponse> {
    const explicitTarget = request.context?.target;
    if (explicitTarget && explicitTarget.type !== "auto") {
      return this.routeExplicitTarget(message, request);
    }

    const deterministicRoute = this.getDeterministicRoute(message);
    await this.auditRouteDecision(deterministicRoute, request);

    if (
      deterministicRoute.route === "internal_ai_assistant" &&
      deterministicRoute.bypassN8n
    ) {
      return this.routeToApp(deterministicRoute, message, request);
    }

    if (env.enableN8nChatbot) {
      const response = await n8nWebhookProvider.getResponse(message, request);
      return { ...response, source: "n8n", routedTo: "n8n" };
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

    if (deterministicRoute.route === "rod_pump_failure") {
      return this.routeToRodPumpBrain(deterministicRoute, message, request);
    }

    if (
      deterministicRoute.route === "chemical_tracker" ||
      deterministicRoute.route === "designer" ||
      deterministicRoute.route === "internal_ai_assistant" ||
      deterministicRoute.route === "pump_tracker"
    ) {
      return this.routeToApp(deterministicRoute, message, request);
    }

    if (deterministicRoute.route === "workflow_brain") {
      return this.routeToWorkflowBrain(deterministicRoute);
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

    if (aiDecision.route === "rod_pump_failure") {
      if (aiDecision.confidence < 0.55) {
        return this.clarifyResponse();
      }
      return this.routeToRodPumpBrain(aiDecision, message, request);
    }

    if (
      aiDecision.route === "chemical_tracker" ||
      aiDecision.route === "designer" ||
      aiDecision.route === "internal_ai_assistant" ||
      aiDecision.route === "pump_tracker"
    ) {
      if (aiDecision.confidence < 0.55) {
        return this.clarifyResponse();
      }
      return this.routeToApp(aiDecision, message, request);
    }

    if (aiDecision.route === "workflow_brain") {
      if (aiDecision.confidence < 0.55) {
        return this.clarifyResponse();
      }
      return this.routeToWorkflowBrain(aiDecision);
    }

    if (aiDecision.route === "general") {
      return this.generalAnswer(message, request.context?.history || []);
    }

    return this.clarifyResponse();
  }

  private async routeExplicitTarget(
    message: string,
    request: ChatRequest,
  ): Promise<ChatResponse> {
    const target = request.context?.target;
    logger.info(
      `[WorkflowBrainDebug][orchestrator:explicit] target=${JSON.stringify(target || null)} topLevelTarget=${JSON.stringify(request.target || null)} topLevelWorkflowBrainCategoryId=${request.workflowBrainCategoryId || ""}`,
    );

    if (!target || target.type === "auto") {
      return this.clarifyResponse();
    }

    if (target.type === "workflow_brain") {
      logger.info(
        `[WorkflowBrainDebug][orchestrator:workflow_brain] categoryId=${target.workflowBrainCategoryId || ""}`,
      );
      if (!target.workflowBrainCategoryId) {
        return {
          reply: "Select a Workflow Brain category before asking this question.",
          timestamp: new Date(),
          confidence: 0.4,
          source: "workflow_brain",
          routedTo: "workflow_brain",
        };
      }

      const brainRole = asKnownRole(request.userRole);
      let result;
      try {
        if (!brainRole) throw new BrainAccessError();
        result = await workflowBrainChatService.answerQuestion(
          target.workflowBrainCategoryId,
          message,
          { id: request.userId || "", role: brainRole },
        );
      } catch (error) {
        if (!(error instanceof BrainAccessError)) throw error;
        await recordBrainAudit({
          userId: request.userId,
          action: "BRAIN_ACCESS_DENIED",
          target: "brain_chat",
          metadata: { categoryId: target.workflowBrainCategoryId },
        });
        return {
          reply: BRAIN_CHAT_ACCESS_DENIED_REPLY,
          timestamp: new Date(),
          confidence: 0.4,
          source: "workflow_brain",
          routedTo: "workflow_brain",
        };
      }

      return {
        reply: result.answer,
        timestamp: new Date(),
        confidence: result.status === "unavailable" ? 0 : result.insufficient ? 0.4 : result.usedAi ? 0.86 : 0.65,
        source: "workflow_brain",
        routedTo: result.categoryName,
        ...(result.citations ? { metadata: { citations: result.citations } } : {}),
      };
    }

    if (target.type === "external_app") {
      if (!target.appName) {
        return {
          reply: "Select an external application before asking this question.",
          timestamp: new Date(),
          confidence: 0.4,
          source: "app",
          routedTo: "external_app",
        };
      }

      const result = await appRouterService.queryApp(
        target.appName,
        message,
        request.userId,
        request.context,
        request.sessionId,
      );

      return {
        reply: result.reply,
        timestamp: new Date(result.timestamp || Date.now()),
        confidence: result.success ? result.confidence || 0.9 : 0,
        source: result.success ? "app" : "error",
        routedTo: target.appName,
      };
    }

    if (target.type === "file_bank") {
      const selectedSource =
        target.documentSource === "local" || target.documentSource === "onedrive"
          ? target.documentSource
          : undefined;

      if (!selectedSource || selectedSource === "onedrive") {
        await oneDriveService.search(message);
      }

      const docs = await documentSearchService.search(message, 5, selectedSource);
      const response = documentSearchService.toChatResponse(docs);
      if (response) return response;

      return {
        reply:
          selectedSource === "onedrive"
            ? "I couldn't find that in the indexed OneDrive folder."
            : selectedSource === "local"
              ? "I couldn't find that in the local File Bank."
              : "I couldn't find that in the File Bank or OneDrive index.",
        timestamp: new Date(),
        confidence: 0.35,
        source: "file_bank",
        routedTo: selectedSource || "documents",
      };
    }

    return this.clarifyResponse();
  }

  private getDeterministicRoute(message: string): RouteDecision {
    return decideChatRoute(message);
  }

  private async getAiRoute(
    message: string,
    history: ContextTurn[],
  ): Promise<RouteDecision> {
    if (!this.openai || !env.enableAiFallback) {
      return {
        route: "clarify",
        query: message,
        confidence: 0,
        matchedRule: "ai_disabled",
        bypassN8n: false,
        reason: "AI fallback disabled.",
      };
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
              "Route OSI assistant requests. Return only JSON with route, query, confidence, and optional category. Routes: file_bank, onedrive, chemical_tracker, designer, internal_ai_assistant, pump_tracker, rod_pump_failure, workflow_brain, general, clarify. Use file_bank/onedrive for documents, PDFs, reports, invoices, proposals requested as files. Use chemical_tracker for wells, clients, chemicals, analytics. Use internal_ai_assistant for ERP data questions, explicit sales order numbers, official sales-order PDFs, file-server sales-order PDF lookup, and drafting or editing technical proposals. Use designer for Designer app workflows, wellbore designs, tallies, simulations, and proposals explicitly in Designer. Use pump_tracker for pump status, pump reports, pump performance. Use rod_pump_failure for rod pump failure analysis, failure modes, run life, similar failure cases, and failure-based design recommendations. Use workflow_brain for process memory, workflow notes, category memory, design checklists, OSI process questions, separator workflow, handoff risks, unknown areas, and operational/design-support workflow guidance.",
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
        "internal_ai_assistant",
        "pump_tracker",
        "rod_pump_failure",
        "workflow_brain",
        "general",
        "clarify",
      ];

      if (!validRoutes.includes(route)) {
        return {
          route: "clarify",
          query: message,
          confidence: 0,
          matchedRule: "ai_invalid_route",
          bypassN8n: false,
          reason: "AI router returned an invalid route.",
        };
      }

      return {
        route,
        query: parsed.query || message,
        confidence:
          typeof parsed.confidence === "number" ? parsed.confidence : 0.5,
        matchedRule: "ai_router",
        bypassN8n: false,
        reason: "AI fallback route classification.",
        category:
          typeof parsed.category === "string" ? parsed.category : undefined,
      };
    } catch (error) {
      logger.warn("AI route classification failed:", error);
      return {
        route: "clarify",
        query: message,
        confidence: 0,
        matchedRule: "ai_error",
        bypassN8n: false,
        reason: "AI route classification failed.",
      };
    }
  }

  private async auditRouteDecision(
    decision: RouteDecision,
    request: ChatRequest,
  ): Promise<void> {
    await recordChatbotAutomationAudit({
      userId: request.userId,
      action: "CHAT_ROUTE_DECISION",
      target: "chatbot",
      metadata: {
        requestId: request.context?.requestId,
        route: decision.route,
        matchedRule: decision.matchedRule,
        confidence: decision.confidence,
        bypassN8n: decision.bypassN8n,
        reason: decision.reason,
      },
    });
  }

  private async routeToApp(
    decision: RouteDecision,
    message: string,
    request: ChatRequest,
  ): Promise<ChatResponse> {
    const appName = APP_ROUTES[
      decision.route as keyof typeof APP_ROUTES
    ];
    const context = {
      ...(request.context || {}),
      operationType: request.context?.operationType || "read",
      routeMetadata: {
        route: decision.route,
        matchedRule: decision.matchedRule,
        confidence: decision.confidence,
        bypassN8n: decision.bypassN8n,
        reason: decision.reason,
      },
    };
    const result = await appRouterService.queryApp(
      appName,
      decision.query || message,
      request.userId,
      context,
      request.sessionId,
    );

    return {
      reply: result.reply,
      timestamp: new Date(result.timestamp || Date.now()),
      confidence: result.success ? result.confidence || decision.confidence : 0,
      source: result.success ? "app" : "error",
      routedTo: appName,
      metadata: result.metadata,
    };
  }

  /**
   * Rod Pump Failure answers in-process for admins; viewers/editors and setups without the
   * category keep the previous behavior (Pump Pro app call).
   */
  private async routeToRodPumpBrain(
    decision: RouteDecision,
    message: string,
    request: ChatRequest,
  ): Promise<ChatResponse> {
    const brainRole = asKnownRole(request.userRole);
    const result = brainRole
      ? await answerRodPumpQuestion({
          message: decision.query || message,
          user: { id: request.userId || "", role: brainRole },
        })
      : ({ route: "fallback_pump_pro" } as const);

    if (result.route === "brain") {
      return {
        reply: result.reply,
        timestamp: new Date(),
        confidence: result.status === "unavailable" ? 0 : result.insufficient ? 0.4 : 0.9,
        source: "workflow_brain",
        routedTo: "Rod Pump Failure",
        ...(result.citations ? { metadata: { citations: result.citations } } : {}),
      };
    }

    return this.routeToApp(
      { ...decision, route: "pump_tracker" },
      message,
      request,
    );
  }

  private async routeToWorkflowBrain(decision: RouteDecision): Promise<ChatResponse> {
    if (!decision.category) {
      return {
        reply: "Which workflow brain category should I use?",
        timestamp: new Date(),
        confidence: 0.75,
        source: "workflow_brain",
        routedTo: "workflow_brain",
      };
    }

    return {
      reply: `I can answer from Workflow Brain when you select a category in the chat drawer. Suggested category: ${decision.category}.`,
      timestamp: new Date(),
      confidence: decision.confidence,
      source: "workflow_brain",
      routedTo: decision.category,
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
