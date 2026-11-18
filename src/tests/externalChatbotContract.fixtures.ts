import {
  externalChatbotRequestSchema,
  externalChatbotResponseSchema,
  wrappedExternalChatbotResponseSchema,
} from "../contracts/externalChatbot.contract";
import { shouldRetryExternalChatbotRequest } from "../services/appRouter.service";

const assertEqual = <T>(actual: T, expected: T, message: string): void => {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
};

const request = externalChatbotRequestSchema.parse({
  message: "give me SO1042",
  userId: "user-1",
  sessionId: "session-1",
  context: {
    requestId: "request-1",
    operationType: "read",
    routeMetadata: {
      route: "internal_ai_assistant",
      matchedRule: "explicit_so_number",
      confidence: 0.95,
      bypassN8n: true,
    },
    user: { id: "user-1", email: "user@example.com", role: "viewer" },
    permissions: { businessUnits: ["bu-1"], departments: ["dept-1"] },
  },
});

assertEqual(request.context?.operationType, "read", "operation type should parse");
assertEqual(
  request.context?.routeMetadata?.matchedRule,
  "explicit_so_number",
  "matched rule should parse",
);

const directResponse = externalChatbotResponseSchema.parse({
  success: true,
  reply: "Connected",
  timestamp: new Date().toISOString(),
  metadata: {
    requestId: "request-1",
    sourceSystem: "internal_ai_assistant",
    toolName: "phase_0_stub",
    durationMs: 12,
  },
});

assertEqual(directResponse.success, true, "direct response should parse");
assertEqual(
  directResponse.metadata?.sourceSystem,
  "internal_ai_assistant",
  "source system should parse",
);

const wrappedResponse = wrappedExternalChatbotResponseSchema.parse({
  success: true,
  data: directResponse,
});

assertEqual(wrappedResponse.data?.reply, "Connected", "wrapped response should parse");

const invalidResponse = externalChatbotResponseSchema.safeParse({
  success: true,
  timestamp: new Date().toISOString(),
});

assertEqual(invalidResponse.success, false, "invalid response should fail");
assertEqual(
  shouldRetryExternalChatbotRequest("read", "NETWORK_ERROR"),
  true,
  "read network errors should retry",
);
assertEqual(
  shouldRetryExternalChatbotRequest("write", "NETWORK_ERROR"),
  false,
  "write network errors should not retry",
);
