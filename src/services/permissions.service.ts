import UserPermission, {
  IUserPermission,
} from "../models/UserPermission.model";
import ExternalApp from "../models/App.model";
import Department from "../models/Department.model";
import logger from "../utils/logger";

interface UserPermissions {
  businessUnits: string[];
  departments: string[];
  applications: string[];
}

/**
 * Resolve all permissions for a user hierarchically
 * - If user has access to a BU, they have access to all its departments and apps
 * - If user has access to a department, they have access to all its apps
 * - Admins and superadmins have access to everything
 */
export const resolveUserPermissions = async (
  userId: string,
  userRole: string,
): Promise<UserPermissions> => {
  // Admins and superadmins have access to everything
  if (userRole === "admin" || userRole === "superadmin") {
    const allBusinessUnits = await import("../models/BusinessUnit.model").then(
      (m) => m.default.find({ isActive: true }).select("_id").lean(),
    );
    const allDepartments = await Department.find({ isActive: true })
      .select("_id")
      .lean();
    const allApps = await ExternalApp.find({ isActive: true })
      .select("_id")
      .lean();

    return {
      businessUnits: allBusinessUnits.map((bu) => bu._id.toString()),
      departments: allDepartments.map((dept) => dept._id.toString()),
      applications: allApps.map((app) => app._id.toString()),
    };
  }

  // Get all user permissions
  const permissions = await UserPermission.find({ userId }).lean();

  const businessUnitIds = new Set<string>();
  const departmentIds = new Set<string>();
  const applicationIds = new Set<string>();

  // Process each permission
  for (const perm of permissions) {
    if (perm.permissionLevel === "businessUnit" && perm.businessUnitId) {
      businessUnitIds.add(perm.businessUnitId.toString());

      // Get all departments in this BU
      const depts = await Department.find({
        businessUnitId: perm.businessUnitId,
        isActive: true,
      })
        .select("_id")
        .lean();

      depts.forEach((dept) => departmentIds.add(dept._id.toString()));

      // Get all apps in this BU
      const apps = await ExternalApp.find({
        businessUnitId: perm.businessUnitId,
        isActive: true,
      })
        .select("_id")
        .lean();

      apps.forEach((app) => applicationIds.add(app._id.toString()));
    } else if (perm.permissionLevel === "department" && perm.departmentId) {
      if (perm.businessUnitId) {
        businessUnitIds.add(perm.businessUnitId.toString());
      }
      departmentIds.add(perm.departmentId.toString());

      // Get all apps in this department
      const apps = await ExternalApp.find({
        departmentId: perm.departmentId,
        isActive: true,
      })
        .select("_id")
        .lean();

      apps.forEach((app) => applicationIds.add(app._id.toString()));
    } else if (perm.permissionLevel === "application" && perm.applicationId) {
      if (perm.businessUnitId) {
        businessUnitIds.add(perm.businessUnitId.toString());
      }
      if (perm.departmentId) {
        departmentIds.add(perm.departmentId.toString());
      }
      applicationIds.add(perm.applicationId.toString());
    }
  }

  return {
    businessUnits: Array.from(businessUnitIds),
    departments: Array.from(departmentIds),
    applications: Array.from(applicationIds),
  };
};

/**
 * Check if user has access to a specific application
 */
export const checkUserAppAccess = async (
  userId: string,
  userRole: string,
  appId: string,
): Promise<boolean> => {
  // Admins and superadmins have access to everything
  if (userRole === "admin" || userRole === "superadmin") {
    return true;
  }

  const permissions = await resolveUserPermissions(userId, userRole);
  return permissions.applications.includes(appId);
};

/**
 * Get all permissions for a specific user
 */
export const getUserPermissions = async (
  userId: string,
): Promise<IUserPermission[]> => {
  return UserPermission.find({ userId })
    .populate("businessUnitId", "name")
    .populate("departmentId", "name")
    .populate("applicationId", "name")
    .lean() as unknown as Promise<IUserPermission[]>;
};

/**
 * Create a new permission for a user
 */
export const createUserPermission = async (
  permissionData: {
    userId: string;
    permissionLevel: "businessUnit" | "department" | "application";
    businessUnitId?: string;
    departmentId?: string;
    applicationId?: string;
  },
  createdBy: string,
): Promise<IUserPermission> => {
  const permission = await UserPermission.create({
    ...permissionData,
    createdBy,
  });

  logger.info(
    `User permission created for user ${permissionData.userId} at level ${permissionData.permissionLevel}`,
  );
  return permission;
};

/**
 * Delete a user permission
 */
export const deleteUserPermission = async (
  permissionId: string,
): Promise<boolean> => {
  const result = await UserPermission.findByIdAndDelete(permissionId);

  if (result) {
    logger.info(`User permission deleted: ${permissionId}`);
    return true;
  }

  return false;
};

/**
 * Bulk update user permissions
 */
export const bulkUpdateUserPermissions = async (
  userId: string,
  permissions: Array<{
    permissionLevel: "businessUnit" | "department" | "application";
    businessUnitId?: string;
    departmentId?: string;
    applicationId?: string;
  }>,
  createdBy: string,
): Promise<IUserPermission[]> => {
  // Delete all existing permissions for this user
  await UserPermission.deleteMany({ userId });

  // Create new permissions
  const newPermissions = await UserPermission.insertMany(
    permissions.map((perm) => ({
      ...perm,
      userId,
      createdBy,
    })),
  );

  logger.info(
    `Bulk updated ${newPermissions.length} permissions for user ${userId}`,
  );
  return newPermissions as unknown as IUserPermission[];
};

export default {
  resolveUserPermissions,
  checkUserAppAccess,
  getUserPermissions,
  createUserPermission,
  deleteUserPermission,
  bulkUpdateUserPermissions,
};
