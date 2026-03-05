import ExternalApp, { IExternalApp } from "../models/App.model";
import { IUser } from "../models/User.model";
import logger from "../utils/logger";
import {
  resolveUserPermissions,
  checkUserAppAccess,
} from "./permissions.service";

const roleHierarchy = {
  viewer: 1,
  editor: 2,
  admin: 3,
  superadmin: 4,
};

export const getAppsForUser = async (user: IUser): Promise<IExternalApp[]> => {
  const userRoleLevel = roleHierarchy[user.role];

  // Get user's hierarchical permissions
  const permissions = await resolveUserPermissions(
    user._id.toString(),
    user.role,
  );

  // Get all active apps
  const apps = await ExternalApp.find({
    isActive: true,
  })
    .populate("businessUnitId", "name")
    .populate("departmentId", "name")
    .lean();

  // Filter apps based on required role AND hierarchical permissions
  const accessibleApps = apps.filter((app) => {
    const requiredRoleLevel = roleHierarchy[app.requiredRole];
    const hasRoleAccess = userRoleLevel >= requiredRoleLevel;

    // Check if user has permission to this app through hierarchy
    const hasPermissionAccess = permissions.applications.includes(
      app._id.toString(),
    );

    return hasRoleAccess && hasPermissionAccess;
  });

  return accessibleApps as unknown as IExternalApp[];
};

export const getAppById = async (
  appId: string,
): Promise<IExternalApp | null> => {
  return ExternalApp.findById(appId).lean() as Promise<IExternalApp | null>;
};

export const getAllApps = async (): Promise<IExternalApp[]> => {
  return ExternalApp.find()
    .populate("createdBy", "firstName lastName email")
    .populate("businessUnitId", "name")
    .populate("departmentId", "name")
    .lean() as unknown as Promise<IExternalApp[]>;
};

export const createApp = async (
  appData: {
    name: string;
    description: string;
    url: string;
    ssoEndpoint?: string;
    iconUrl?: string;
    category: string;
    requiredRole: string;
    businessUnitId: string;
    departmentId: string;
    isActive?: boolean;
  },
  createdBy: string,
): Promise<IExternalApp> => {
  const app = await ExternalApp.create({
    ...appData,
    createdBy,
  });

  logger.info(`External app created: ${app.name} by user ${createdBy}`);
  return app;
};

export const updateApp = async (
  appId: string,
  updateData: Partial<IExternalApp>,
): Promise<IExternalApp | null> => {
  const app = await ExternalApp.findByIdAndUpdate(appId, updateData, {
    new: true,
    runValidators: true,
  });

  if (app) {
    logger.info(`External app updated: ${app.name}`);
  }

  return app;
};

export const deleteApp = async (appId: string): Promise<boolean> => {
  const result = await ExternalApp.findByIdAndDelete(appId);

  if (result) {
    logger.info(`External app deleted: ${result.name}`);
    return true;
  }

  return false;
};

export const checkUserAccess = async (
  user: IUser,
  app: IExternalApp,
): Promise<boolean> => {
  const userRoleLevel = roleHierarchy[user.role];
  const requiredRoleLevel = roleHierarchy[app.requiredRole];

  // Check role access
  const hasRoleAccess = userRoleLevel >= requiredRoleLevel;

  // Check hierarchical permission access
  const hasPermissionAccess = await checkUserAppAccess(
    user._id.toString(),
    user.role,
    app._id.toString(),
  );

  return hasRoleAccess && hasPermissionAccess;
};

export const getAppsByDepartment = async (
  departmentId: string,
): Promise<IExternalApp[]> => {
  return ExternalApp.find({ departmentId, isActive: true })
    .populate("createdBy", "firstName lastName email")
    .populate("businessUnitId", "name")
    .populate("departmentId", "name")
    .lean() as unknown as Promise<IExternalApp[]>;
};

export const getAppsByBusinessUnit = async (
  businessUnitId: string,
): Promise<IExternalApp[]> => {
  return ExternalApp.find({ businessUnitId, isActive: true })
    .populate("createdBy", "firstName lastName email")
    .populate("businessUnitId", "name")
    .populate("departmentId", "name")
    .lean() as unknown as Promise<IExternalApp[]>;
};

export default {
  getAppsForUser,
  getAppById,
  getAllApps,
  getAppsByDepartment,
  getAppsByBusinessUnit,
  createApp,
  updateApp,
  deleteApp,
  checkUserAccess,
};
