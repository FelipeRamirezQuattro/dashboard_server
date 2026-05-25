import OpenAI from "openai";
import { env } from "../config/env";
import { requireCategoryState } from "./workflowBrainState.service";
import logger from "../utils/logger";

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
      status: object.status,
    };
  });

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "what",
  "when",
  "where",
  "who",
  "whos",
  "whose",
  "why",
]);

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokensFor = (value: string) =>
  normalize(value)
    .split(/\s+/)
    .filter((token) => token.length > 2 && !stopWords.has(token));

const memoryContent = (memory: unknown) => {
  if (!memory || typeof memory !== "object") return "";
  const object = memory as { content?: string; summary?: string };
  return object.content || object.summary || "";
};

const cleanMemoryFact = (content: string) =>
  content
    .replace(/^\s*you\s+must\s+remember\s+/i, "")
    .replace(/^\s*remember\s+/i, "")
    .trim();

const answerDirectMemoryQuestion = (
  question: string,
  categoryName: string,
  memories: unknown[],
) => {
  const questionTokens = new Set(tokensFor(question));
  if (questionTokens.size === 0) return null;

  const candidates = memories
    .map((memory) => {
      const content = memoryContent(memory);
      const cleaned = cleanMemoryFact(content);
      const memoryTokens = new Set(tokensFor(cleaned));
      const overlap = [...questionTokens].filter((token) =>
        memoryTokens.has(token),
      ).length;
      return { content, cleaned, overlap };
    })
    .filter((candidate) => candidate.cleaned.length > 0)
    .sort((a, b) => b.overlap - a.overlap);

  const best = candidates[0];
  logger.info(
    `[WorkflowBrainDebug][brain:direct-memory] questionTokens=${JSON.stringify([...questionTokens])} candidates=${JSON.stringify(candidates.slice(0, 5).map((candidate) => ({
      cleaned: candidate.cleaned.slice(0, 160),
      overlap: candidate.overlap,
    })))}`,
  );
  if (!best || best.overlap < 2) return null;

  const asksForHead =
    /\b(who|whos|whose)\b/.test(normalize(question)) &&
    questionTokens.has("head");
  const headMatch = best.cleaned.match(/^(.+?)\s+is\s+the\s+head\s+of\s+(.+?)(?:\.|$)/i);

  if (asksForHead && headMatch) {
    return `Based on ${categoryName} Workflow Brain memory: ${headMatch[1].trim()} is the head of ${headMatch[2].trim()}.`;
  }

  return `Based on ${categoryName} Workflow Brain memory: ${best.cleaned}`;
};

const answerFromMemory = (
  question: string,
  categoryName: string,
  memories: unknown[],
  workflowSteps: unknown[],
) => {
  const memoryLines = summarizeItems(memories, 8)
    .map((item, index) => {
      const object = item as { content?: string; summary?: string };
      return `${index + 1}. ${object.summary || object.content || ""}`;
    })
    .filter((line) => line.trim().length > 3);
  const workflowLines = summarizeItems(workflowSteps, 8)
    .map((item, index) => {
      const object = item as { name?: string; description?: string; status?: string };
      return `${index + 1}. ${object.name || "Workflow step"}${object.description ? `: ${object.description}` : ""}${object.status ? ` (${object.status})` : ""}`;
    })
    .filter((line) => line.trim().length > 3);

  if (!memoryLines.length && !workflowLines.length) {
    return [
      `I do not have enough saved memory in ${categoryName} to answer this yet.`,
      "Add verified process notes or facts to this Workflow Brain category, then ask again.",
      `Question: ${question}`,
    ].join("\n");
  }

  return [
    `Based on the saved ${categoryName} Workflow Brain memory:`,
    ...memoryLines,
    workflowLines.length ? "" : undefined,
    workflowLines.length ? "Current workflow context:" : undefined,
    ...workflowLines,
    "",
    "Use this as internal OSI support context. Engineering review is required for final technical decisions or equipment specifications.",
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};

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
    logger.info(
      `[WorkflowBrainDebug][brain:start] categoryId=${categoryId} categoryName="${categoryName}" memoryCount=${state.memories.length} workflowStepCount=${state.workflowSteps.length} question="${question.slice(0, 160)}"`,
    );
    const directMemoryAnswer = answerDirectMemoryQuestion(
      question,
      categoryName,
      state.memories,
    );

    if (directMemoryAnswer) {
      logger.info(
        `[WorkflowBrainDebug][brain:answer] mode=direct-memory categoryName="${categoryName}" answer="${directMemoryAnswer.slice(0, 220)}"`,
      );
      return {
        answer: directMemoryAnswer,
        categoryName,
        usedAi: false,
      };
    }

    if (!this.openai) {
      logger.info(
        `[WorkflowBrainDebug][brain:answer] mode=mock-memory categoryName="${categoryName}"`,
      );
      return {
        answer: answerFromMemory(
          question,
          categoryName,
          state.memories,
          state.workflowSteps,
        ),
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
            "Answer using only the selected Workflow Brain category memory and workflow context supplied by the API call.",
            "If the memory contains a direct factual answer, use that fact directly and do not say you lack the information.",
            "Be practical, specific, and useful for OSI client workflow/process/design-support questions.",
            "Do not create final engineering specifications or certified calculations.",
            "If the saved memory is thin, say what is missing and suggest what memory should be added.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            selectedCategory: state.category,
            memoryFacts: summarizeItems(state.memories, 40),
            workflowSteps: summarizeItems(state.workflowSteps, 40),
            question,
          }),
        },
      ],
    });

    const aiAnswer =
      completion.choices[0]?.message?.content?.trim() ||
      "I could not generate a Workflow Brain answer for that category.";
    logger.info(
      `[WorkflowBrainDebug][brain:answer] mode=openai categoryName="${categoryName}" answer="${aiAnswer.slice(0, 220)}"`,
    );

    return {
      answer: aiAnswer,
      categoryName,
      usedAi: true,
    };
  }
}

export const workflowBrainChatService = new WorkflowBrainChatService();
