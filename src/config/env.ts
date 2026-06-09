import dotenv from "dotenv";

dotenv.config();

interface EnvConfig {
  port: number;
  nodeEnv: string;
  frontendUrl: string;
  mongodbUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  refreshTokenSecret: string;
  refreshTokenExpiresIn: string;
  sessionSecret: string;
  azureClientId: string;
  azureClientSecret: string;
  azureTenantId: string;
  azureRedirectUri: string;
  encryptionKey: string;
  ssoSuperAdminEmails: string[];
  ssoAdminEmails: string[];
  ssoEditorEmails: string[];
  // AI Chatbot Configuration (Optional)
  openaiApiKey?: string;
  openaiModel?: string;
  anthropicApiKey?: string;
  enableAiFallback: boolean;
  // External app chatbot service-to-service API keys (Optional)
  chemtrackerChatbotApiKey?: string;
  designerChatbotApiKey?: string;
  pumpTrackerChatbotApiKey?: string;
  // n8n Webhook Chatbot (Alternative approach — set ENABLE_N8N_CHATBOT=true to activate)
  enableN8nChatbot: boolean;
  n8nWebhookUrl: string;
  chatbotAiRouterModel: string;
  chatbotConnectorTimeoutMs: number;
  chatbotToolApiKey?: string;
  // OneDrive / SharePoint document source (Optional)
  oneDriveClientId?: string;
  oneDriveClientSecret?: string;
  oneDriveTenantId?: string;
  oneDriveDriveId?: string;
  oneDriveFolderItemId?: string;
  oneDriveFolderWebUrl?: string;
  // AWS S3 File Bank object storage
  awsRegion?: string;
  awsS3Bucket?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  awsS3Endpoint?: string;
}

const requiredEnvVars = [
  "MONGODB_URI",
  "JWT_SECRET",
  "REFRESH_TOKEN_SECRET",
  "SESSION_SECRET",
  "AZURE_CLIENT_ID",
  "AZURE_CLIENT_SECRET",
  "AZURE_TENANT_ID",
  "ENCRYPTION_KEY",
];

// Validate required environment variables
const missingVars = requiredEnvVars.filter((varName) => !process.env[varName]);
if (missingVars.length > 0) {
  console.error(
    `Missing required environment variables: ${missingVars.join(", ")}`,
  );
  if (process.env.NODE_ENV !== "test") {
    process.exit(1);
  }
}

export const env: EnvConfig = {
  port: parseInt(process.env.PORT || "4000", 10),
  nodeEnv: process.env.NODE_ENV || "development",
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  mongodbUri: process.env.MONGODB_URI || "",
  jwtSecret: process.env.JWT_SECRET || "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || "",
  refreshTokenExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || "7d",
  sessionSecret: process.env.SESSION_SECRET || "",
  azureClientId: process.env.AZURE_CLIENT_ID || "",
  azureClientSecret: process.env.AZURE_CLIENT_SECRET || "",
  azureTenantId: process.env.AZURE_TENANT_ID || "",
  azureRedirectUri:
    process.env.AZURE_REDIRECT_URI ||
    "http://localhost:4000/api-dashboard/auth/sso/microsoft/callback",
  encryptionKey: process.env.ENCRYPTION_KEY || "",
  ssoSuperAdminEmails: process.env.SSO_SUPERADMIN_EMAILS
    ? process.env.SSO_SUPERADMIN_EMAILS.split(",").map((email) =>
        email.trim().toLowerCase(),
      )
    : [],
  ssoAdminEmails: process.env.SSO_ADMIN_EMAILS
    ? process.env.SSO_ADMIN_EMAILS.split(",").map((email) =>
        email.trim().toLowerCase(),
      )
    : [],
  ssoEditorEmails: process.env.SSO_EDITOR_EMAILS
    ? process.env.SSO_EDITOR_EMAILS.split(",").map((email) =>
        email.trim().toLowerCase(),
      )
    : [],
  // AI Chatbot Configuration (Optional - enables AI fallback)
  openaiApiKey: process.env.OPENAI_API_KEY,
  openaiModel: process.env.OPENAI_MODEL || "gpt-4o-mini",
  enableAiFallback:
    process.env.ENABLE_AI_FALLBACK?.toLowerCase() === "true" || false,
  // External app chatbot service-to-service API keys (Optional)
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  chemtrackerChatbotApiKey: process.env.CHEMTRACKER_CHATBOT_API_KEY,
  designerChatbotApiKey: process.env.DESIGNER_CHATBOT_API_KEY,
  pumpTrackerChatbotApiKey: process.env.PUMPTRACKER_CHATBOT_API_KEY,
  // n8n Webhook Chatbot (Alternative approach — set ENABLE_N8N_CHATBOT=true to activate)
  enableN8nChatbot:
    process.env.ENABLE_N8N_CHATBOT?.toLowerCase() === "true" || false,
  n8nWebhookUrl:
    process.env.N8N_WEBHOOK_URL ||
    "https://felipe-osi.app.n8n.cloud/webhook/osi-agent",
  chatbotAiRouterModel: process.env.CHATBOT_AI_ROUTER_MODEL || "gpt-4o-mini",
  chatbotConnectorTimeoutMs: parseInt(
    process.env.CHATBOT_CONNECTOR_TIMEOUT_MS || "20000",
    10,
  ),
  chatbotToolApiKey: process.env.CHATBOT_TOOL_API_KEY,
  oneDriveClientId: process.env.ONEDRIVE_CLIENT_ID || process.env.AZURE_CLIENT_ID,
  oneDriveClientSecret:
    process.env.ONEDRIVE_CLIENT_SECRET || process.env.AZURE_CLIENT_SECRET,
  oneDriveTenantId:
    process.env.ONEDRIVE_TENANT_ID || process.env.AZURE_TENANT_ID,
  oneDriveDriveId: process.env.ONEDRIVE_DRIVE_ID,
  oneDriveFolderItemId: process.env.ONEDRIVE_FOLDER_ITEM_ID,
  oneDriveFolderWebUrl: process.env.ONEDRIVE_FOLDER_WEB_URL,
  awsRegion: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
  awsS3Bucket: process.env.AWS_S3_BUCKET,
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  awsS3Endpoint: process.env.AWS_S3_ENDPOINT,
};

export default env;
