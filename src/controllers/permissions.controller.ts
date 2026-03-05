import { Request, Response } from "express";
import * as permissionsService from "../services/permissions.service";

export const getUserPermissions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { userId } = req.params;
    const permissions = await permissionsService.getUserPermissions(userId);
    res.json(permissions);
  } catch (error) {
    console.error("Error fetching user permissions:", error);
    res.status(500).json({ error: "Failed to fetch user permissions" });
  }
};

export const resolveUserPermissions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { userId } = req.params;
    const { role } = req.query;

    const permissions = await permissionsService.resolveUserPermissions(
      userId,
      role as string,
    );
    res.json(permissions);
  } catch (error) {
    console.error("Error resolving user permissions:", error);
    res.status(500).json({ error: "Failed to resolve user permissions" });
  }
};

export const createUserPermission = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const {
      userId,
      permissionLevel,
      businessUnitId,
      departmentId,
      applicationId,
    } = req.body;

    if (!userId || !permissionLevel) {
      res
        .status(400)
        .json({ error: "userId and permissionLevel are required" });
      return;
    }

    const permission = await permissionsService.createUserPermission(
      {
        userId,
        permissionLevel,
        businessUnitId,
        departmentId,
        applicationId,
      },
      req.user!._id.toString(),
    );

    res.status(201).json(permission);
  } catch (error: any) {
    console.error("Error creating user permission:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to create user permission" });
  }
};

export const deleteUserPermission = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const success = await permissionsService.deleteUserPermission(id);

    if (!success) {
      res.status(404).json({ error: "Permission not found" });
      return;
    }

    res.json({ message: "Permission deleted successfully" });
  } catch (error) {
    console.error("Error deleting permission:", error);
    res.status(500).json({ error: "Failed to delete permission" });
  }
};

export const bulkUpdateUserPermissions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { userId } = req.params;
    const { permissions } = req.body;

    if (!permissions || !Array.isArray(permissions)) {
      res.status(400).json({ error: "permissions array is required" });
      return;
    }

    const newPermissions = await permissionsService.bulkUpdateUserPermissions(
      userId,
      permissions,
      req.user!._id.toString(),
    );

    res.json(newPermissions);
  } catch (error: any) {
    console.error("Error bulk updating permissions:", error);
    res
      .status(500)
      .json({ error: error.message || "Failed to bulk update permissions" });
  }
};

export default {
  getUserPermissions,
  resolveUserPermissions,
  createUserPermission,
  deleteUserPermission,
  bulkUpdateUserPermissions,
};
