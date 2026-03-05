import { Router } from "express";
import passport from "passport";
import * as authController from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth.middleware";
import { auditLog } from "../middleware/audit.middleware";
import { env } from "../config/env";

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
  passport.authenticate("azuread-openidconnect", {
    failureRedirect: `${env.frontendUrl}/login`,
  }),
);

router.get(
  "/sso/microsoft/callback",
  passport.authenticate("azuread-openidconnect", {
    failureRedirect: `${env.frontendUrl}/login`,
  }),
  auditLog("USER_SSO_LOGIN"),
  authController.ssoMicrosoftCallback,
);

// Get current user
router.get("/me", authenticate, authController.getCurrentUser);

export default router;
