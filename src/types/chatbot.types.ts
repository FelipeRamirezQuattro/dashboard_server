export interface ChatMessage {
  id: string;
  message: string;
  sender: "user" | "bot";
  timestamp: Date;
}

export interface ChatRequest {
  message: string;
  userId?: string;
  sessionId?: string;
  context?: {
    history?: Array<{
      role: "user" | "assistant";
      content: string;
    }>;
  };
}

export interface ChatResponse {
  reply: string;
  timestamp: Date;
  confidence?: number;
}

export interface Intent {
  patterns: (string | RegExp)[];
  response: string;
  keywords?: string[];
}

export interface ChatProvider {
  getResponse(message: string, request?: ChatRequest): Promise<ChatResponse>;
}
