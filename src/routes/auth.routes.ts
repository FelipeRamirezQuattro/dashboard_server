import { Router } from "express";
import passport from "passport";
import * as authController from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";
import { auditLog } from "../middleware/audit.middleware";
import { env } from "../config/env";
import logger from "../utils/logger";

const router = Router();

// Local login
router.post("/login", auditLog("USER_LOGIN"), authController.login);

// Refresh access token
router.post("/refresh", authController.refresh);

// Logout
router.post(
  "/logout",
  authenticate,
  auditLog("USER_LOGOUT"),
  authController.logout,
);

// Microsoft SSO
router.get(
  "/sso/microsoft",
  (req, res, next) => {
    logger.info("Initiating Microsoft SSO authentication");
    passport.authenticate("azuread-openidconnect", {
      failureRedirect: `${env.frontendUrl}/login?error=sso_init_failed`,
    })(req, res, next);
  }
);

router.get(
  "/sso/microsoft/callback",
  (req, res, next) => {
    logger.info("Microsoft SSO callback received");
    passport.authenticate("azuread-openidconnect", {
      failureRedirect: `${env.frontendUrl}/login?error=sso_auth_failed`,
    })(req, res, next);
  },
  auditLog("USER_SSO_LOGIN"),
  authController.ssoMicrosoftCallback,
);

// Get current user
router.get("/me", authenticate, authController.getCurrentUser);

export default router;
