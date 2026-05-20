import OpenAI from "openai";
import { env } from "../config/env";
import { WorkflowBrainState } from "./workflowBrainState.service";
import {
  designOutputSchema,
  WorkflowAnalysis,
  workflowAnalysisSchema,
  WorkflowDesignOutput,
} from "./workflowBrainMockAnalyzer.service";

const systemPrompt = [
  "You are OSI's internal workflow and design-support analyst for oil & gas equipment operations at Odessa Separator Inc.",
  "Use only the selected category context provided in the request. Do not blend in other categories or outside company assumptions.",
  "Preserve OSI-specific terminology and keep recommendations practical for oil and gas equipment operations.",
  "Avoid generic SaaS, automation, no-code, or small-business consulting language.",
  "Do not recommend external workflow tools by default.",
  "Identify missing technical or process information, separate known facts from assumptions, and provide practical next steps.",
  "For engineering-sensitive topics, provide support guidance, checklists, workflow advice, and process recommendations only.",
  "Do not produce certified engineering calculations, final equipment specifications, or statements that replace engineering judgment.",
  "State when engineering review is required.",
].join(" ");

const safeJson = (content: string): unknown => {
  try {
    return JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI response was not JSON");
    return JSON.parse(match[0]);
  }
};

const summarizeState = (state: WorkflowBrainState) => ({
  category: state.category,
  memories: state.memories,
  entities: state.entities,
  workflowSteps: state.workflowSteps,
  bottlenecks: state.bottlenecks,
  recommendations: state.recommendations,
  insights: state.insights,
  unknownAreas: state.unknownAreas,
});

class WorkflowBrainOpenaiService {
  private openai?: OpenAI;

  constructor() {
    if (env.openaiApiKey) {
      this.openai = new OpenAI({ apiKey: env.openaiApiKey });
    }
  }

  isEnabled(): boolean {
    return Boolean(this.openai);
  }

  async analyzeNote(note: string, state: WorkflowBrainState): Promise<WorkflowAnalysis> {
    if (!this.openai) throw new Error("OpenAI API key is not configured");

    const completion = await this.openai.chat.completions.create({
      model: env.openaiModel || "gpt-4o-mini",
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `${systemPrompt} Return strict JSON with arrays named entities, workflowSteps, workflowEdges, bottlenecks, recommendations, insights, and unknownAreas. Use exact enum values from the schema implied by the field names.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            selectedCategoryState: summarizeState(state),
            note,
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    return workflowAnalysisSchema.parse(safeJson(raw));
  }

  async createDesignOutput(
    request: string,
    state: WorkflowBrainState,
  ): Promise<WorkflowDesignOutput> {
    if (!this.openai) throw new Error("OpenAI API key is not configured");

    const completion = await this.openai.chat.completions.create({
      model: env.openaiModel || "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            `${systemPrompt} Return strict JSON with title, answer, assumptions, requiredInputs, risks, recommendedNextSteps, and relatedEntities. The answer must be operational/design-support guidance, not a final engineering specification.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            selectedCategoryState: summarizeState(state),
            request,
          }),
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content || "{}";
    return designOutputSchema.parse(safeJson(raw));
  }
}

export const workflowBrainOpenaiService = new WorkflowBrainOpenaiService();
