import { Request, Response } from "express";
import * as authService from "../services/auth.service";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt.utils";
import RefreshToken from "../models/RefreshToken.model";
import logger from "../utils/logger";
import { IUser } from "../models/User.model";

export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const result = await authService.loginWithCredentials(email, password);

    // Set refresh token as httpOnly cookie
    res.cookie("refreshToken", result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      user: result.user,
      accessToken: result.accessToken,
    });
  } catch (error) {
    logger.error("Login error:", error);
    res.status(401).json({ error: (error as Error).message });
  }
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      res.status(401).json({ error: "Refresh token not found" });
      return;
    }

    const result = await authService.refreshAccessToken(refreshToken);

    res.json({
      accessToken: result.accessToken,
    });
  } catch (error) {
    logger.error("Token refresh error:", error);
    res.status(401).json({ error: (error as Error).message });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (refreshToken) {
      await authService.logout(refreshToken);
    }

    res.clearCookie("refreshToken");
    res.json({ message: "Logged out successfully" });
  } catch (error) {
    logger.error("Logout error:", error);
    res.status(500).json({ error: "Logout failed" });
  }
};

export const ssoMicrosoft = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  // This is handled by Passport.js middleware
  // If we reach here, authentication failed
  res.redirect(`${process.env.FRONTEND_URL}/login?error=sso_failed`);
};

export const ssoMicrosoftCallback = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    logger.info("SSO callback initiated");
    const user = req.user as IUser;

    if (!user) {
      logger.error("SSO callback: No user found in request");
      res.redirect(`${process.env.FRONTEND_URL}/login?error=sso_no_user`);
      return;
    }

    logger.info(`SSO callback: User found - ${user.email}`);

    // Generate JWT tokens
    const tokenPayload = {
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    logger.info(`Generating tokens for user: ${user.email}`);
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);
    logger.info("Tokens generated successfully");

    // Store refresh token
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await RefreshToken.create({
      userId: user._id,
      token: refreshToken,
      expiresAt,
    });

    // Set refresh token cookie
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Clear session after successful auth (we're using JWT, not sessions)
    req.session.destroy((err) => {
      if (err) {
        logger.error("Session destruction error:", err);
      }
    });

    // Redirect to frontend with access token
    const redirectUrl = `${process.env.FRONTEND_URL}/auth/callback?token=${accessToken}`;
    logger.info(`Redirecting to: ${redirectUrl.substring(0, redirectUrl.indexOf('?token='))}`);
    res.redirect(redirectUrl);
  } catch (error) {
    logger.error("SSO callback error:", error);
    const errorMessage = error instanceof Error ? error.message : "unknown";
    logger.error(`Error details: ${errorMessage}`);
    res.redirect(`${process.env.FRONTEND_URL}/login?error=sso_callback_error&details=${encodeURIComponent(errorMessage)}`);
  }
};

export const getCurrentUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    res.json({ user: req.user });
  } catch (error) {
    logger.error("Get current user error:", error);
    res.status(500).json({ error: "Failed to get user data" });
  }
};

export default {
  login,
  refresh,
  logout,
  ssoMicrosoft,
  ssoMicrosoftCallback,
  getCurrentUser,
};
