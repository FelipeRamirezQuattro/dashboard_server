import { Request, Response } from "express";
import * as appsService from "../services/apps.service";
import AuditLog from "../models/AuditLog.model";
import logger from "../utils/logger";

// App Management
export const getAllApps = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const apps = await appsService.getAllApps();
    res.json({ apps });
  } catch (error) {
    logger.error("Get all apps error:", error);
    res.status(500).json({ error: "Failed to fetch apps" });
  }
};

export const createApp = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const {
      name,
      description,
      url,
      chatbotApiUrl,
      ssoEndpoint,
      iconUrl,
      category,
      requiredRole,
      businessUnitId,
      departmentId,
      isActive,
    } = req.body;

    if (
      !name ||
      !description ||
      !url ||
      !category ||
      !requiredRole ||
      !businessUnitId ||
      !departmentId
    ) {
      res.status(400).json({
        error:
          "Name, description, URL, category, required role, business unit, and department are required",
      });
      return;
    }

    const appData = {
      name,
      description,
      url,
      chatbotApiUrl,
      ssoEndpoint,
      iconUrl,
      category,
      requiredRole,
      businessUnitId,
      departmentId,
      isActive: isActive !== undefined ? isActive : true,
    };

    const app = await appsService.createApp(appData, req.user._id.toString());

    res.status(201).json({
      app,
      message: "Application created successfully",
    });
  } catch (error) {
    logger.error("Create app error:", error);
    res.status(400).json({ error: (error as Error).message });
  }
};

export const updateApp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const app = await appsService.updateApp(id, updateData);

    if (!app) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    res.json({
      app,
      message: "Application updated successfully",
    });
  } catch (error) {
    logger.error("Update app error:", error);
    res.status(400).json({ error: (error as Error).message });
  }
};

export const deleteApp = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const success = await appsService.deleteApp(id);

    if (!success) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    res.json({ message: "Application deleted successfully" });
  } catch (error) {
    logger.error("Delete app error:", error);
    res.status(500).json({ error: "Failed to delete application" });
  }
};

// Audit Logs
export const getAuditLogs = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const {
      startDate,
      endDate,
      userId,
      action,
      limit = 100,
      page = 1,
    } = req.query;

    const query: any = {};

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) query.createdAt.$lte = new Date(endDate as string);
    }

    if (userId) query.userId = userId;
    if (action) query.action = action;

    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      AuditLog.find(query)
        .populate("userId", "firstName lastName email")
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .skip(skip)
        .lean(),
      AuditLog.countDocuments(query),
    ]);

    res.json({
      logs,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    logger.error("Get audit logs error:", error);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
};

export default {
  getAllApps,
  createApp,
  updateApp,
  deleteApp,
  getAuditLogs,
};
