import User, { IUser } from "../models/User.model";
import RefreshToken from "../models/RefreshToken.model";
import { generateAccessToken, generateRefreshToken } from "../utils/jwt.utils";
import logger from "../utils/logger";

export interface LoginResponse {
  user: Partial<IUser>;
  accessToken: string;
  refreshToken: string;
}

export const loginWithCredentials = async (
  email: string,
  password: string,
): Promise<LoginResponse> => {
  // Find user with password hash
  const user = await User.findOne({ email, isActive: true }).select(
    "+passwordHash",
  );

  if (!user) {
    throw new Error("Invalid email or password");
  }

  if (!user.passwordHash) {
    throw new Error("This account uses SSO. Please sign in with Microsoft.");
  }

  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    throw new Error("Invalid email or password");
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save();

  // Generate tokens
  const tokenPayload = {
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
  };

  const accessToken = generateAccessToken(tokenPayload);
  const refreshToken = generateRefreshToken(tokenPayload);

  // Store refresh token in database
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

  await RefreshToken.create({
    userId: user._id,
    token: refreshToken,
    expiresAt,
  });

  logger.info(`User logged in: ${email}`);

  // Remove sensitive data
  const userObject = user.toJSON() as unknown as Partial<IUser>;

  return {
    user: userObject,
    accessToken,
    refreshToken,
  };
};

export const refreshAccessToken = async (
  refreshToken: string,
): Promise<{ accessToken: string }> => {
  const tokenRecord = await RefreshToken.findOne({
    expiresAt: { $gte: new Date() },
  }).select("+token");

  if (!tokenRecord) {
    throw new Error("Invalid refresh token");
  }

  const isValid = await tokenRecord.compareToken(refreshToken);

  if (!isValid) {
    throw new Error("Invalid refresh token");
  }

  const user = await User.findById(tokenRecord.userId);

  if (!user || !user.isActive) {
    throw new Error("User not found or inactive");
  }

  const tokenPayload = {
    userId: user._id.toString(),
    email: user.email,
    role: user.role,
  };

  const accessToken = generateAccessToken(tokenPayload);

  return { accessToken };
};

export const logout = async (refreshToken: string): Promise<void> => {
  await RefreshToken.deleteMany({
    token: refreshToken,
  });
};

export const createUser = async (userData: {
  firstName: string;
  lastName: string;
  email: string;
  password?: string;
  role?: string;
}): Promise<IUser> => {
  const existingUser = await User.findOne({ email: userData.email });

  if (existingUser) {
    throw new Error("User with this email already exists");
  }

  const user = await User.create({
    firstName: userData.firstName,
    lastName: userData.lastName,
    email: userData.email,
    passwordHash: userData.password,
    role: userData.role || "viewer",
    isActive: true,
  });

  logger.info(`User created: ${user.email}`);

  return user;
};

export default {
  loginWithCredentials,
  refreshAccessToken,
  logout,
  createUser,
};
