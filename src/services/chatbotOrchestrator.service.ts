import OpenAI from "openai";
import { ChatRequest, ChatResponse } from "../types/chatbot.types";
import { HardcodedChatProvider } from "./chatbot.service";
import { appRouterService } from "./appRouter.service";
import { documentSearchService } from "./documentSearch.service";
import { n8nWebhookProvider } from "./n8nWebhook.service";
import { oneDriveService } from "./oneDrive.service";
import { workflowBrainChatService } from "./workflowBrainChat.service";
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
  | "workflow_brain"
  | "general"
  | "clarify";

interface RouteDecision {
  route: RouteTarget;
  query: string;
  confidence: number;
  category?: string;
}

const APP_ROUTES: Record<Exclude<RouteTarget, "file_bank" | "onedrive" | "workflow_brain" | "general" | "clarify">, string> = {
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
    const explicitTarget = request.context?.target;
    if (explicitTarget && explicitTarget.type !== "auto") {
      return this.routeExplicitTarget(message, request);
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

    if (aiDecision.route === "workflow_brain") {
      if (aiDecision.confidence < 0.55) {
        return this.clarifyResponse();
      }
      return this.routeToWorkflowBrain(aiDecision);
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

  private async routeExplicitTarget(
    message: string,
    request: ChatRequest,
  ): Promise<ChatResponse> {
    const target = request.context?.target;

    if (!target || target.type === "auto") {
      return this.clarifyResponse();
    }

    if (target.type === "workflow_brain") {
      if (!target.workflowBrainCategoryId) {
        return {
          reply: "Select a Workflow Brain category before asking this question.",
          timestamp: new Date(),
          confidence: 0.4,
          source: "workflow_brain",
          routedTo: "workflow_brain",
        };
      }

      const result = await workflowBrainChatService.answerQuestion(
        target.workflowBrainCategoryId,
        message,
      );

      return {
        reply: result.answer,
        timestamp: new Date(),
        confidence: result.usedAi ? 0.86 : 0.65,
        source: "workflow_brain",
        routedTo: result.categoryName,
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

    if (
      /\b(workflow\s+brain|process\s+brain|design\s+brain|category\s+memory|workflow\s+category|osi\s+process|separator\s+workflow|design\s+checklist)\b/.test(msg) ||
      /\b(workflow|process|handoff|checklist|bottleneck|unknown\s+areas?)\b.*\b(separator|design|engineering|qa|qc|proposal|sales)\b/.test(msg)
    ) {
      return {
        route: "workflow_brain",
        query: message,
        confidence: 0.9,
        category: this.detectWorkflowBrainCategory(msg),
      };
    }

    return { route: "clarify", query: message, confidence: 0 };
  }

  private detectWorkflowBrainCategory(message: string): string | undefined {
    if (/\b(gas|separator|separation)\b/.test(message)) return "Gas Separation";
    if (/\b(chemical|treatment)\b/.test(message)) return "Chemical Treatment";
    if (/\b(sand|filtration|filter)\b/.test(message)) return "Sand / Filtration Control";
    if (/\b(sales|handoff)\b/.test(message)) return "Sales Engineering";
    if (/\b(qa|qc|quality|inspection)\b/.test(message)) return "QA/QC";
    if (/\b(proposal|proposals)\b/.test(message)) return "Proposals";
    if (/\b(field service|service)\b/.test(message)) return "Field Service";
    if (/\b(manufacturing|shop|fabrication)\b/.test(message)) return "Manufacturing";
    return undefined;
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
              "Route OSI assistant requests. Return only JSON with route, query, confidence, and optional category. Routes: file_bank, onedrive, chemical_tracker, designer, pump_tracker, workflow_brain, general, clarify. Use file_bank/onedrive for documents, PDFs, reports, invoices, proposals requested as files. Use chemical_tracker for wells, clients, chemicals, analytics. Use designer for proposals, sales orders, designs, tallies, simulations. Use pump_tracker for pump status, pump reports, pump performance. Use workflow_brain for process memory, workflow notes, category memory, design checklists, OSI process questions, separator workflow, handoff risks, bottlenecks, unknown areas, and operational/design-support workflow guidance.",
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
        "workflow_brain",
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
        category:
          typeof parsed.category === "string" ? parsed.category : undefined,
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
