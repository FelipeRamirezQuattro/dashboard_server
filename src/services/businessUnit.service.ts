import BusinessUnit, { IBusinessUnit } from "../models/BusinessUnit.model";
import logger from "../utils/logger";

export const getAllBusinessUnits = async (): Promise<IBusinessUnit[]> => {
  return BusinessUnit.find()
    .populate("createdBy", "firstName lastName email")
    .lean() as unknown as Promise<IBusinessUnit[]>;
};

export const getActiveBusinessUnits = async (): Promise<IBusinessUnit[]> => {
  return BusinessUnit.find({ isActive: true })
    .populate("createdBy", "firstName lastName email")
    .lean() as unknown as Promise<IBusinessUnit[]>;
};

export const getBusinessUnitById = async (
  buId: string,
): Promise<IBusinessUnit | null> => {
  return BusinessUnit.findById(buId)
    .populate("createdBy", "firstName lastName email")
    .lean() as Promise<IBusinessUnit | null>;
};

export const createBusinessUnit = async (
  buData: {
    name: string;
    description: string;
    isActive?: boolean;
  },
  createdBy: string,
): Promise<IBusinessUnit> => {
  const bu = await BusinessUnit.create({
    ...buData,
    createdBy,
  });

  logger.info(`Business Unit created: ${bu.name} by user ${createdBy}`);
  return bu;
};

export const updateBusinessUnit = async (
  buId: string,
  updateData: Partial<IBusinessUnit>,
): Promise<IBusinessUnit | null> => {
  const bu = await BusinessUnit.findByIdAndUpdate(buId, updateData, {
    new: true,
    runValidators: true,
  });

  if (bu) {
    logger.info(`Business Unit updated: ${bu.name}`);
  }

  return bu;
};

export const deleteBusinessUnit = async (buId: string): Promise<boolean> => {
  // Soft delete by setting isActive to false
  const bu = await BusinessUnit.findByIdAndUpdate(
    buId,
    { isActive: false },
    { new: true },
  );

  if (bu) {
    logger.info(`Business Unit deactivated: ${bu.name}`);
    return true;
  }

  return false;
};

export const hardDeleteBusinessUnit = async (
  buId: string,
): Promise<boolean> => {
  const result = await BusinessUnit.findByIdAndDelete(buId);

  if (result) {
    logger.info(`Business Unit hard deleted: ${result.name}`);
    return true;
  }

  return false;
};

export default {
  getAllBusinessUnits,
  getActiveBusinessUnits,
  getBusinessUnitById,
  createBusinessUnit,
  updateBusinessUnit,
  deleteBusinessUnit,
  hardDeleteBusinessUnit,
};
