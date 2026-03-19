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
  ssoAdminEmails: string[];
  ssoEditorEmails: string[];
  // AI Chatbot Configuration (Optional)
  openaiApiKey?: string;
  openaiModel?: string;
  enableAiFallback: boolean;
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
};

export default env;
