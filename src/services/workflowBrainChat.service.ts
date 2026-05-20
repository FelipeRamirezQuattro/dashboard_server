import OpenAI from "openai";
import { env } from "../config/env";
import { requireCategoryState } from "./workflowBrainState.service";
import { createDesignWithMock } from "./workflowBrainMockAnalyzer.service";

const summarizeItems = (items: unknown[], limit: number): unknown[] =>
  items.slice(0, limit).map((item) => {
    if (!item || typeof item !== "object") return item;
    const object = item as Record<string, unknown>;
    return {
      name: object.name,
      title: object.title,
      summary: object.summary,
      content: object.content,
      description: object.description,
      severity: object.severity,
      status: object.status,
      answer: object.answer,
      requiredInputs: object.requiredInputs,
      risks: object.risks,
      recommendedNextSteps: object.recommendedNextSteps,
    };
  });

class WorkflowBrainChatService {
  private openai?: OpenAI;

  constructor() {
    if (env.openaiApiKey) {
      this.openai = new OpenAI({ apiKey: env.openaiApiKey });
    }
  }

  async answerQuestion(
    categoryId: string,
    question: string,
  ): Promise<{ answer: string; categoryName: string; usedAi: boolean }> {
    const state = await requireCategoryState(categoryId);
    const category = state.category as { name?: string; description?: string };
    const categoryName = category.name || "Selected Workflow Brain category";

    if (!this.openai) {
      const output = createDesignWithMock(question, state);
      return {
        answer: output.answer,
        categoryName,
        usedAi: false,
      };
    }

    const completion = await this.openai.chat.completions.create({
      model: env.openaiModel || "gpt-4o-mini",
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: [
            "You are the OSI Workflow Brain assistant for Odessa Separator Inc.",
            "Answer using only the selected category memory/context.",
            "Be practical, specific, and useful for internal workflow/process/design-support work.",
            "Do not create final engineering specifications or certified calculations.",
            "If category memory is thin, say what is missing and suggest what to add to memory.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            selectedCategory: state.category,
            memoryFacts: summarizeItems(state.memories, 40),
            workflowSteps: summarizeItems(state.workflowSteps, 40),
            bottlenecks: summarizeItems(state.bottlenecks, 20),
            recommendations: summarizeItems(state.recommendations, 20),
            insights: summarizeItems(state.insights, 20),
            unknownAreas: summarizeItems(state.unknownAreas, 20),
            recentDesignOutputs: summarizeItems(state.designOutputs, 8),
            question,
          }),
        },
      ],
    });

    return {
      answer:
        completion.choices[0]?.message?.content?.trim() ||
        "I could not generate a Workflow Brain answer for that category.",
      categoryName,
      usedAi: true,
    };
  }
}

export const workflowBrainChatService = new WorkflowBrainChatService();
