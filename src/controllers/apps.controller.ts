import { Request, Response } from "express";
import * as appsService from "../services/apps.service";
import * as ssoService from "../services/sso.service";
import logger from "../utils/logger";

export const getApps = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const apps = await appsService.getAppsForUser(req.user);
    res.json({ apps });
  } catch (error) {
    logger.error("Get apps error:", error);
    res.status(500).json({ error: "Failed to fetch apps" });
  }
};

export const launchApp = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { appId } = req.params;
    const app = await appsService.getAppById(appId);

    if (!app) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    if (!app.isActive) {
      res.status(403).json({ error: "Application is not active" });
      return;
    }

    // Check if user has access to this app
    const hasAccess = appsService.checkUserAccess(req.user, app);

    if (!hasAccess) {
      res.status(403).json({
        error: "Insufficient permissions to access this application",
        requiredRole: app.requiredRole,
        currentRole: req.user.role,
      });
      return;
    }

    // If app has SSO endpoint, get On-Behalf-Of token
    if (app.ssoEndpoint) {
      // Check if user has Microsoft SSO linked
      if (!req.user.microsoftId) {
        res.status(403).json({
          error: "Microsoft SSO required",
          message:
            "This application requires Microsoft SSO. Please sign in with Microsoft to access.",
        });
        return;
      }

      try {
        // Get user's Microsoft access token
        const userMsToken = await ssoService.getMicrosoftAccessToken(req.user);

        // Exchange for app-specific token using On-Behalf-Of flow
        const appToken = await ssoService.getOnBehalfOfToken(
          userMsToken,
          app.ssoEndpoint,
        );

        // Return launch URL with token
        const launchUrl = `${app.url}?token=${appToken}`;

        res.json({
          launchUrl,
          app: {
            name: app.name,
            description: app.description,
          },
        });
      } catch (error) {
        logger.error("SSO token exchange error:", error);
        res.status(500).json({
          error: "Failed to obtain SSO token",
          message: "Please sign in with Microsoft and try again.",
        });
      }
    } else {
      // No SSO, just return the app URL
      res.json({
        launchUrl: app.url,
        app: {
          name: app.name,
          description: app.description,
        },
      });
    }
  } catch (error) {
    logger.error("Launch app error:", error);
    res.status(500).json({ error: "Failed to launch application" });
  }
};

export default {
  getApps,
  launchApp,
};
