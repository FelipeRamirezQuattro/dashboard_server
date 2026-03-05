import { Request, Response, NextFunction } from "express";
import { UserRole } from "../models/User.model";
import logger from "../utils/logger";

const roleHierarchy: Record<UserRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  superadmin: 4,
};

export const requireRole = (requiredRole: UserRole | UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const userRoleLevel = roleHierarchy[req.user.role];

    // Handle array of roles - user needs to have at least one of them
    if (Array.isArray(requiredRole)) {
      const hasRequiredRole = requiredRole.some((role) => {
        const requiredRoleLevel = roleHierarchy[role];
        return userRoleLevel >= requiredRoleLevel;
      });

      if (!hasRequiredRole) {
        logger.warn(
          `Access denied for user ${req.user.email} (${req.user.role}) to resource requiring one of: ${requiredRole.join(", ")}`,
        );
        res.status(403).json({
          error: "Insufficient permissions",
          required: requiredRole,
          current: req.user.role,
        });
        return;
      }
    } else {
      // Handle single role
      const requiredRoleLevel = roleHierarchy[requiredRole];

      if (userRoleLevel < requiredRoleLevel) {
        logger.warn(
          `Access denied for user ${req.user.email} (${req.user.role}) to ${requiredRole}-only resource`,
        );
        res.status(403).json({
          error: "Insufficient permissions",
          required: requiredRole,
          current: req.user.role,
        });
        return;
      }
    }

    next();
  };
};

export const requireAdmin = requireRole("admin");
export const requireSuperAdmin = requireRole("superadmin");

export default requireRole;
