import { Request, Response } from "express";
import * as businessUnitService from "../services/businessUnit.service";

export const getAllBusinessUnits = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const businessUnits = await businessUnitService.getAllBusinessUnits();
    res.json(businessUnits);
  } catch (error) {
    console.error("Error fetching business units:", error);
    res.status(500).json({ error: "Failed to fetch business units" });
  }
};

export const getActiveBusinessUnits = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const businessUnits = await businessUnitService.getActiveBusinessUnits();
    res.json(businessUnits);
  } catch (error) {
    console.error("Error fetching active business units:", error);
    res.status(500).json({ error: "Failed to fetch active business units" });
  }
};

export const getBusinessUnitById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const businessUnit = await businessUnitService.getBusinessUnitById(id);

    if (!businessUnit) {
      res.status(404).json({ error: "Business unit not found" });
      return;
    }

    res.json(businessUnit);
  } catch (error) {
    console.error("Error fetching business unit:", error);
    res.status(500).json({ error: "Failed to fetch business unit" });
  }
};

export const createBusinessUnit = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { name, description, isActive } = req.body;

    if (!name || !description) {
      res.status(400).json({ error: "Name and description are required" });
      return;
    }

    const businessUnit = await businessUnitService.createBusinessUnit(
      { name, description, isActive },
      req.user!._id.toString(),
    );

    res.status(201).json(businessUnit);
  } catch (error: any) {
    console.error("Error creating business unit:", error);
    if (error.code === 11000) {
      res.status(409).json({ error: "Business unit name already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to create business unit" });
  }
};

export const updateBusinessUnit = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const businessUnit = await businessUnitService.updateBusinessUnit(
      id,
      updateData,
    );

    if (!businessUnit) {
      res.status(404).json({ error: "Business unit not found" });
      return;
    }

    res.json(businessUnit);
  } catch (error: any) {
    console.error("Error updating business unit:", error);
    if (error.code === 11000) {
      res.status(409).json({ error: "Business unit name already exists" });
      return;
    }
    res.status(500).json({ error: "Failed to update business unit" });
  }
};

export const deleteBusinessUnit = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const success = await businessUnitService.deleteBusinessUnit(id);

    if (!success) {
      res.status(404).json({ error: "Business unit not found" });
      return;
    }

    res.json({ message: "Business unit deactivated successfully" });
  } catch (error) {
    console.error("Error deleting business unit:", error);
    res.status(500).json({ error: "Failed to delete business unit" });
  }
};

export default {
  getAllBusinessUnits,
  getActiveBusinessUnits,
  getBusinessUnitById,
  createBusinessUnit,
  updateBusinessUnit,
  deleteBusinessUnit,
};
