import express, { Application } from "express";
import session from "express-session";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import passport from "passport";
import { env } from "./config/env";
import { connectDB } from "./config/db";
import { configurePassport } from "./config/passport";
import logger from "./utils/logger";
import { errorHandler, notFound } from "./middleware/errorHandler";

// Routes
import authRoutes from "./routes/auth.routes";
import appsRoutes from "./routes/apps.routes";
import usersRoutes from "./routes/users.routes";
import adminRoutes from "./routes/admin.routes";
import businessUnitRoutes from "./routes/businessUnit.routes";
import departmentRoutes from "./routes/department.routes";
import permissionsRoutes from "./routes/permissions.routes";
import chatbotRoutes from "./routes/chatbot.routes";

const app: Application = express();

// Connect to database
connectDB();

// Configure Passport
configurePassport();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: env.frontendUrl,
    credentials: true,
  }),
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: env.nodeEnv === "development" ? 1000 : 100, // Higher limit in development
  message: "Too many requests from this IP, please try again later.",
  skip: (req) => {
    // Skip rate limiting for SSO callback in development
    if (env.nodeEnv === "development" && req.path.includes("/auth/sso/")) {
      return true;
    }
    return false;
  },
});

app.use("/api-dashboard/", limiter);

// Body parsing middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session middleware (required for Azure AD OIDC strategy)
app.use(
  session({
    secret: env.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: env.nodeEnv === "production",
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  }),
);

// Initialize Passport
app.use(passport.initialize());
app.use(passport.session());

// Request logging
app.use((req, _res, next) => {
  logger.http(`${req.method} ${req.originalUrl}`);
  next();
});

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "OK", timestamp: new Date().toISOString() });
});

// API Routes
app.use("/api-dashboard/auth", authRoutes);
app.use("/api-dashboard/apps", appsRoutes);
app.use("/api-dashboard/users", usersRoutes);
app.use("/api-dashboard/admin", adminRoutes);
app.use("/api-dashboard/business-units", businessUnitRoutes);
app.use("/api-dashboard/departments", departmentRoutes);
app.use("/api-dashboard/permissions", permissionsRoutes);
app.use("/api-dashboard/chatbot", chatbotRoutes);

// 404 handler
app.use(notFound);

// Error handler (must be last)
app.use(errorHandler);

// Start server
const PORT = env.port;

app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT} in ${env.nodeEnv} mode`);
  logger.info(`📊 Frontend URL: ${env.frontendUrl}`);
});

// Handle unhandled promise rejections
process.on("unhandledRejection", (err: Error) => {
  logger.error("Unhandled Promise Rejection:", err);
  process.exit(1);
});

export default app;
