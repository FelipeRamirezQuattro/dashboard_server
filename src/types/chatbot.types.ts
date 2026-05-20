export interface ChatMessage {
  id: string;
  message: string;
  sender: "user" | "bot";
  timestamp: Date;
}

export interface ChatRequest {
  message: string;
  userId?: string;
  userEmail?: string;
  sessionId?: string;
  context?: {
    history?: Array<{
      role: "user" | "assistant";
      content: string;
    }>;
    target?: ChatTarget;
  };
}

export interface ChatResponse {
  reply: string;
  timestamp: Date;
  confidence?: number;
  source?:
    | "static"
    | "file_bank"
    | "onedrive"
    | "app"
    | "ai"
    | "workflow_brain"
    | "n8n"
    | "error";
  routedTo?: string;
  documents?: ChatDocumentResult[];
}

export interface ChatDocumentResult {
  id: string;
  name: string;
  url: string;
  source: "local" | "onedrive";
  description?: string;
  tags?: string[];
}

export interface ChatTarget {
  type: "auto" | "workflow_brain" | "external_app" | "file_bank";
  workflowBrainCategoryId?: string;
  appName?: string;
  documentSource?: "all" | "local" | "onedrive";
}

export interface Intent {
  patterns: (string | RegExp)[];
  response: string;
  keywords?: string[];
}

export interface ChatProvider {
  getResponse(message: string, request?: ChatRequest): Promise<ChatResponse>;
}
