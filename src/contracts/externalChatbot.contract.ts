import { z } from "zod";

export const operationTypeSchema = z.enum(["read", "write"]).default("read");

export const routeMetadataSchema = z
  .object({
    route: z.string().optional(),
    matchedRule: z.string().optional(),
    confidence: z.number().optional(),
    bypassN8n: z.boolean().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

export const externalChatbotRequestSchema = z.object({
  message: z.string().min(1),
  userId: z.string().optional(),
  sessionId: z.string().optional(),
  context: z
    .object({
      requestId: z.string().optional(),
      operationType: operationTypeSchema.optional(),
      idempotencyKey: z.string().optional(),
      routeMetadata: routeMetadataSchema.optional(),
      user: z
        .object({
          id: z.string().optional(),
          email: z.string().optional(),
          role: z.string().optional(),
        })
        .passthrough()
        .optional(),
      permissions: z
        .object({
          businessUnits: z.array(z.string()).default([]),
          departments: z.array(z.string()).default([]),
          applications: z.array(z.string()).default([]),
        })
        .partial()
        .passthrough()
        .optional(),
    })
    .passthrough()
    .optional(),
});

export const externalChatbotDocumentSchema = z
  .object({
    id: z.string(),
    title: z.string().optional(),
    name: z.string().optional(),
    downloadUrl: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

export const externalChatbotResponseSchema = z.object({
  success: z.boolean(),
  reply: z.string(),
  timestamp: z.string(),
  confidence: z.number().optional(),
  metadata: z
    .object({
      queryType: z.string().optional(),
      resultsCount: z.number().optional(),
      processingMethod: z.string().optional(),
      route: z.string().optional(),
      matchedRule: z.string().optional(),
      sourceSystem: z.string().optional(),
      requestId: z.string().optional(),
      toolName: z.string().optional(),
      durationMs: z.number().optional(),
    })
    .passthrough()
    .optional(),
  documents: z.array(externalChatbotDocumentSchema).optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export const wrappedExternalChatbotResponseSchema = z.object({
  success: z.boolean().optional(),
  data: externalChatbotResponseSchema.optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
});

export type ExternalChatbotRequest = z.infer<
  typeof externalChatbotRequestSchema
>;
export type ExternalChatbotResponse = z.infer<
  typeof externalChatbotResponseSchema
>;
