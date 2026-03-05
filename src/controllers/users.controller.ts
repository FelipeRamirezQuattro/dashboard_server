import { Request, Response } from "express";
import User from "../models/User.model";
import * as authService from "../services/auth.service";
import logger from "../utils/logger";

export const getUsers = async (_req: Request, res: Response): Promise<void> => {
  try {
    const users = await User.find()
      .select("-passwordHash -msAccessToken -msRefreshToken")
      .sort({ createdAt: -1 });

    res.json({ users });
  } catch (error) {
    logger.error("Get users error:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

export const getUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const user = await User.findById(id).select(
      "-passwordHash -msAccessToken -msRefreshToken",
    );

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json({ user });
  } catch (error) {
    logger.error("Get user error:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
};

export const createUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { firstName, lastName, email, password, role } = req.body;

    if (!firstName || !lastName || !email) {
      res
        .status(400)
        .json({ error: "First name, last name, and email are required" });
      return;
    }

    const userData = {
      firstName,
      lastName,
      email,
      password,
      role: role || "viewer",
    };

    const user = await authService.createUser(userData);

    res.status(201).json({
      user,
      message: "User created successfully",
    });
  } catch (error) {
    logger.error("Create user error:", error);
    res.status(400).json({ error: (error as Error).message });
  }
};

export const updateUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;
    const { firstName, lastName, email, role, isActive, password } = req.body;

    const user = await User.findById(id).select("+passwordHash");

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Update fields
    if (firstName !== undefined) user.firstName = firstName;
    if (lastName !== undefined) user.lastName = lastName;
    if (email !== undefined) user.email = email;
    if (role !== undefined) user.role = role;
    if (isActive !== undefined) user.isActive = isActive;
    if (password) user.passwordHash = password;

    await user.save();

    // Return user without sensitive data
    const updatedUser = await User.findById(id).select(
      "-passwordHash -msAccessToken -msRefreshToken",
    );

    res.json({
      user: updatedUser,
      message: "User updated successfully",
    });
  } catch (error) {
    logger.error("Update user error:", error);
    res.status(400).json({ error: (error as Error).message });
  }
};

export const deleteUser = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (req.user && req.user._id.toString() === id) {
      res.status(403).json({ error: "Cannot delete your own account" });
      return;
    }

    const user = await User.findByIdAndDelete(id);

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    logger.info(`User deleted: ${user.email} by ${req.user?.email}`);

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    logger.error("Delete user error:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
};

export default {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
};
