import Department, { IDepartment } from "../models/Department.model";
import logger from "../utils/logger";

export const getAllDepartments = async (): Promise<IDepartment[]> => {
  return Department.find()
    .populate("businessUnitId", "name")
    .populate("createdBy", "firstName lastName email")
    .lean() as unknown as Promise<IDepartment[]>;
};

export const getActiveDepartments = async (): Promise<IDepartment[]> => {
  return Department.find({ isActive: true })
    .populate("businessUnitId", "name")
    .populate("createdBy", "firstName lastName email")
    .lean() as unknown as Promise<IDepartment[]>;
};

export const getDepartmentById = async (
  deptId: string,
): Promise<IDepartment | null> => {
  return Department.findById(deptId)
    .populate("businessUnitId", "name")
    .populate("createdBy", "firstName lastName email")
    .lean() as Promise<IDepartment | null>;
};

export const getDepartmentsByBusinessUnit = async (
  businessUnitId: string,
): Promise<IDepartment[]> => {
  return Department.find({ businessUnitId, isActive: true })
    .populate("createdBy", "firstName lastName email")
    .lean() as unknown as Promise<IDepartment[]>;
};

export const createDepartment = async (
  deptData: {
    name: string;
    description: string;
    businessUnitId: string;
    isActive?: boolean;
  },
  createdBy: string,
): Promise<IDepartment> => {
  const dept = await Department.create({
    ...deptData,
    createdBy,
  });

  logger.info(
    `Department created: ${dept.name} in BU ${deptData.businessUnitId} by user ${createdBy}`,
  );
  return dept;
};

export const updateDepartment = async (
  deptId: string,
  updateData: Partial<IDepartment>,
): Promise<IDepartment | null> => {
  const dept = await Department.findByIdAndUpdate(deptId, updateData, {
    new: true,
    runValidators: true,
  });

  if (dept) {
    logger.info(`Department updated: ${dept.name}`);
  }

  return dept;
};

export const deleteDepartment = async (deptId: string): Promise<boolean> => {
  // Soft delete by setting isActive to false
  const dept = await Department.findByIdAndUpdate(
    deptId,
    { isActive: false },
    { new: true },
  );

  if (dept) {
    logger.info(`Department deactivated: ${dept.name}`);
    return true;
  }

  return false;
};

export const hardDeleteDepartment = async (
  deptId: string,
): Promise<boolean> => {
  const result = await Department.findByIdAndDelete(deptId);

  if (result) {
    logger.info(`Department hard deleted: ${result.name}`);
    return true;
  }

  return false;
};

export default {
  getAllDepartments,
  getActiveDepartments,
  getDepartmentById,
  getDepartmentsByBusinessUnit,
  createDepartment,
  updateDepartment,
  deleteDepartment,
  hardDeleteDepartment,
};
