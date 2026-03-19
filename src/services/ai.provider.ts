import OpenAI from "openai";
import { ChatProvider, ChatResponse } from "../types/chatbot.types";
import { env } from "../config/env";
import logger from "../utils/logger";
import { appRouterService } from "./appRouter.service";

/**
 * System prompt that teaches AI about OSI and how to route to applications
 */
const SYSTEM_PROMPT = `You are the OSI Assistant, a helpful chatbot for Odessa Separator Inc. (OSI).

## About OSI
OSI provides oilfield solutions including:
- Filtration and Sand Control
- Gas Separation technologies
- Chemical Treatment systems for downhole environments

OSI serves the Oil & Gas industry with multiple business units and departments.

## Your Role
You are the ROUTER. Your job is to:
1. Understand what the user is asking about
2. Determine which application can answer their question
3. Route the query to the correct application

## Available Applications

### Chemical Tracker
Handles queries about:
- Wells and well data
- Chemical levels (Fe, Mn, THPS, etc.)
- Chemical tracking and analysis
- Clients in chemical tracking system
To route: Respond with "ROUTE:Chemical Tracker"

### OSI Pump Pro
Handles queries about:
- Pump pulling reports
- Pump teardowns and inspections
- Pump component tracking
- Barrel, plunger, valve data
To route: Respond with "ROUTE:OSI Pump Pro"

### Designer
Handles queries about:
- Well design and engineering
- Technical proposals
- Sales orders
- 3D wellbore visualization
- Engineering calculations
To route: Respond with "ROUTE:Designer"

### OSI (General Company Info)
For questions about:
- Company overview
- Services and solutions  
- Business units and departments
- Company vision and mission
Answer these DIRECTLY - do not route.

## How to Respond

**Example 1 - Route to app:**
User: "show me wells with high iron levels"
You: "ROUTE:Chemical Tracker"

**Example 2 - Route to app:**
User: "what pump pulling reports do we have?"
You: "ROUTE:OSI Pump Pro"

**Example 3 - Answer directly:**
User: "What does OSI do?"
You: "Odessa Separator Inc. provides oilfield solutions including Filtration/Sand Control, Gas Separation, and Chemical Treatment for downhole environments to enhance production efficiency."

**Example 4 - Out of scope:**
User: "What's the weather?"
You: "I'm the OSI Assistant and can help with information about OSI and our applications like Chemical Tracker, Pump Pro, and Designer. I can't help with weather information."

## Rules
1. If question is about specific data (wells, pumps, proposals, etc.) → ROUTE to the correct app
2. If question is about OSI company info → Answer directly
3. If unclear which app → Ask for clarification
4. If out of scope → Politely explain what you can help with

Keep responses professional, concise, and helpful.`;

/**
 * AIChatProvider
 * Uses OpenAI to understand user intent and generate responses
 * Falls back when pattern matching doesn't work
 */
export class AIChatProvider implements ChatProvider {
  private client: OpenAI | null = null;
  private isEnabled: boolean = false;

  constructor() {
    // Only initialize if API key is provided
    if (env.openaiApiKey) {
      try {
        this.client = new OpenAI({
          apiKey: env.openaiApiKey,
        });
        this.isEnabled = true;
        logger.info("AI Chat Provider initialized successfully");
      } catch (error) {
        logger.error("Failed to initialize OpenAI client:", error);
        this.isEnabled = false;
      }
    } else {
      logger.warn(
        "OpenAI API key not provided. AI fallback is disabled. Set OPENAI_API_KEY in .env to enable.",
      );
      this.isEnabled = false;
    }
  }

  async getResponse(message: string): Promise<ChatResponse> {
    if (!this.isEnabled || !this.client) {
      return {
        reply:
          "AI assistant is not configured. Please contact your administrator.",
        timestamp: new Date(),
        confidence: 0,
      };
    }

    try {
      logger.info(`AI processing message: ${message.substring(0, 50)}...`);

      const completion = await this.client.chat.completions.create({
        model: env.openaiModel || "gpt-4o-mini", // Use mini for cost savings
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: message,
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const aiResponse = completion.choices[0]?.message?.content || "";

      // Check if AI wants to route to an external app
      if (aiResponse.startsWith("ROUTE:")) {
        const appName = aiResponse.replace("ROUTE:", "").trim();
        return await this.routeToApp(appName, message);
      }

      // Direct answer from AI
      return {
        reply: aiResponse,
        timestamp: new Date(),
        confidence: 0.8,
      };
    } catch (error: any) {
      logger.error("AI provider error:", error);

      // Handle specific OpenAI errors
      if (error.status === 401) {
        return {
          reply: "AI service authentication failed. Please check API key.",
          timestamp: new Date(),
          confidence: 0,
        };
      }

      if (error.status === 429) {
        return {
          reply:
            "AI service is currently rate limited. Please try again in a moment.",
          timestamp: new Date(),
          confidence: 0,
        };
      }

      return {
        reply:
          "I encountered an error while processing your request. Please try again.",
        timestamp: new Date(),
        confidence: 0,
      };
    }
  }

  /**
   * Route query to external application's chatbot
   */
  private async routeToApp(
    appName: string,
    message: string,
  ): Promise<ChatResponse> {
    try {
      logger.info(`AI routing to ${appName}`);

      const response = await appRouterService.queryApp(appName, message);

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
   * Check if AI provider is enabled and ready
   */
  isReady(): boolean {
    return this.isEnabled;
  }
}
