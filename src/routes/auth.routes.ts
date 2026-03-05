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
router.get("/sso/microsoft", (req, res, next) => {
  logger.info("Initiating Microsoft SSO authentication");
  passport.authenticate("azuread-openidconnect", {
    failureRedirect: `${env.frontendUrl}/login?error=sso_init_failed`,
  })(req, res, next);
});

router.get(
  "/sso/microsoft/callback",
  (req, res, next) => {
    logger.info("Microsoft SSO callback received");
    logger.info("Session ID:", req.sessionID);
    logger.info("Session data:", JSON.stringify(req.session, null, 2));
    logger.info("Query params:", JSON.stringify(req.query, null, 2));
    
    // Use custom callback to capture authentication errors
    passport.authenticate("azuread-openidconnect", (err: any, user: any, info: any) => {
      if (err) {
        logger.error("Passport authentication error:", err);
        logger.error("Error details:", JSON.stringify(err, null, 2));
        return res.redirect(`${env.frontendUrl}/login?error=sso_auth_failed&details=${encodeURIComponent(err.message || 'Unknown error')}`);
      }
      
      if (!user) {
        logger.error("Passport authentication failed - no user returned");
        logger.error("Info:", info);
        return res.redirect(`${env.frontendUrl}/login?error=sso_auth_failed&details=No user returned`);
      }
      
      logger.info("Passport authentication successful, logging in user");
      
      // Manually log the user in
      req.logIn(user, (loginErr: any) => {
        if (loginErr) {
          logger.error("Login error:", loginErr);
          return res.redirect(`${env.frontendUrl}/login?error=sso_auth_failed&details=${encodeURIComponent(loginErr.message)}`);
        }
        
        logger.info("User logged in successfully, proceeding to callback handler");
        next();
      });
    })(req, res, next);
  },
  auditLog("USER_SSO_LOGIN"),
  authController.ssoMicrosoftCallback,
);

// Get current user
router.get("/me", authenticate, authController.getCurrentUser);

export default router;
