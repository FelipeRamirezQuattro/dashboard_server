import { Request, Response } from "express";
import * as departmentService from "../services/department.service";

export const getAllDepartments = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const departments = await departmentService.getAllDepartments();
    res.json(departments);
  } catch (error) {
    console.error("Error fetching departments:", error);
    res.status(500).json({ error: "Failed to fetch departments" });
  }
};

export const getActiveDepartments = async (
  _req: Request,
  res: Response,
): Promise<void> => {
  try {
    const departments = await departmentService.getActiveDepartments();
    res.json(departments);
  } catch (error) {
    console.error("Error fetching active departments:", error);
    res.status(500).json({ error: "Failed to fetch active departments" });
  }
};

export const getDepartmentById = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const department = await departmentService.getDepartmentById(id);

    if (!department) {
      res.status(404).json({ error: "Department not found" });
      return;
    }

    res.json(department);
  } catch (error) {
    console.error("Error fetching department:", error);
    res.status(500).json({ error: "Failed to fetch department" });
  }
};

export const getDepartmentsByBusinessUnit = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { buId } = req.params;
    const departments =
      await departmentService.getDepartmentsByBusinessUnit(buId);
    res.json(departments);
  } catch (error) {
    console.error("Error fetching departments by business unit:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch departments by business unit" });
  }
};

export const createDepartment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { name, description, businessUnitId, isActive } = req.body;

    if (!name || !description || !businessUnitId) {
      res.status(400).json({
        error: "Name, description, and businessUnitId are required",
      });
      return;
    }

    const department = await departmentService.createDepartment(
      { name, description, businessUnitId, isActive },
      req.user!._id.toString(),
    );

    res.status(201).json(department);
  } catch (error: any) {
    console.error("Error creating department:", error);
    if (error.code === 11000) {
      res
        .status(409)
        .json({
          error: "Department name already exists in this business unit",
        });
      return;
    }
    res.status(500).json({ error: "Failed to create department" });
  }
};

export const updateDepartment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const department = await departmentService.updateDepartment(id, updateData);

    if (!department) {
      res.status(404).json({ error: "Department not found" });
      return;
    }

    res.json(department);
  } catch (error: any) {
    console.error("Error updating department:", error);
    if (error.code === 11000) {
      res
        .status(409)
        .json({
          error: "Department name already exists in this business unit",
        });
      return;
    }
    res.status(500).json({ error: "Failed to update department" });
  }
};

export const deleteDepartment = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const success = await departmentService.deleteDepartment(id);

    if (!success) {
      res.status(404).json({ error: "Department not found" });
      return;
    }

    res.json({ message: "Department deactivated successfully" });
  } catch (error) {
    console.error("Error deleting department:", error);
    res.status(500).json({ error: "Failed to delete department" });
  }
};

export default {
  getAllDepartments,
  getActiveDepartments,
  getDepartmentById,
  getDepartmentsByBusinessUnit,
  createDepartment,
  updateDepartment,
  deleteDepartment,
};
