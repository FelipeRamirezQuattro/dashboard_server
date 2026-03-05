/// <reference path="../types/express.d.ts" />
import { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../utils/jwt.utils";
import User from "../models/User.model";
import logger from "../utils/logger";

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "No token provided" });
      return;
    }

    const token = authHeader.substring(7);

    try {
      const payload = verifyAccessToken(token);
      req.jwtPayload = payload;

      // Fetch full user from database
      const user = await User.findById(payload.userId);

      if (!user) {
        res.status(401).json({ error: "User not found" });
        return;
      }

      if (!user.isActive) {
        res.status(403).json({ error: "User account is inactive" });
        return;
      }

      req.user = user;
      next();
    } catch (error) {
      logger.error("Token verification failed:", error);
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
  } catch (error) {
    logger.error("Authentication middleware error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export default authenticate;
