import axios from "axios";
import CryptoJS from "crypto-js";
import { env } from "../config/env";
import { IUser } from "../models/User.model";
import logger from "../utils/logger";

export interface MicrosoftTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export const encryptToken = (token: string): string => {
  return CryptoJS.AES.encrypt(token, env.encryptionKey).toString();
};

export const decryptToken = (encryptedToken: string): string => {
  const bytes = CryptoJS.AES.decrypt(encryptedToken, env.encryptionKey);
  return bytes.toString(CryptoJS.enc.Utf8);
};

export const storeMicrosoftTokens = async (
  user: IUser,
  accessToken: string,
  refreshToken?: string,
  expiresIn?: number,
): Promise<void> => {
  user.msAccessToken = encryptToken(accessToken);

  if (refreshToken) {
    user.msRefreshToken = encryptToken(refreshToken);
  }

  if (expiresIn) {
    const expiry = new Date();
    expiry.setSeconds(expiry.getSeconds() + expiresIn);
    user.msTokenExpiry = expiry;
  }

  await user.save();
  logger.info(`Microsoft tokens stored for user: ${user.email}`);
};

export const getMicrosoftAccessToken = async (user: IUser): Promise<string> => {
  // Check if we have a valid token
  if (
    user.msAccessToken &&
    user.msTokenExpiry &&
    user.msTokenExpiry > new Date()
  ) {
    return decryptToken(user.msAccessToken);
  }

  // Try to refresh the token
  if (user.msRefreshToken) {
    try {
      const refreshedToken = await refreshMicrosoftToken(user);
      return refreshedToken;
    } catch (error) {
      logger.error("Failed to refresh Microsoft token:", error);
      throw new Error(
        "Microsoft token expired. Please sign in with Microsoft again.",
      );
    }
  }

  throw new Error("No valid Microsoft token. Please sign in with Microsoft.");
};

export const refreshMicrosoftToken = async (user: IUser): Promise<string> => {
  if (!user.msRefreshToken) {
    throw new Error("No refresh token available");
  }

  const refreshToken = decryptToken(user.msRefreshToken);

  try {
    const response = await axios.post<MicrosoftTokenResponse>(
      `https://login.microsoftonline.com/${env.azureTenantId}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: env.azureClientId,
        client_secret: env.azureClientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
        scope: "openid profile email offline_access",
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    await storeMicrosoftTokens(
      user,
      response.data.access_token,
      response.data.refresh_token,
      response.data.expires_in,
    );

    return response.data.access_token;
  } catch (error) {
    logger.error("Error refreshing Microsoft token:", error);
    throw new Error("Failed to refresh Microsoft token");
  }
};

export const getOnBehalfOfToken = async (
  userAccessToken: string,
  targetResource: string,
): Promise<string> => {
  try {
    const response = await axios.post<MicrosoftTokenResponse>(
      `https://login.microsoftonline.com/${env.azureTenantId}/oauth2/v2.0/token`,
      new URLSearchParams({
        client_id: env.azureClientId,
        client_secret: env.azureClientSecret,
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: userAccessToken,
        requested_token_use: "on_behalf_of",
        scope: targetResource,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    return response.data.access_token;
  } catch (error) {
    logger.error("Error obtaining On-Behalf-Of token:", error);
    throw new Error("Failed to obtain SSO token for target application");
  }
};

export default {
  encryptToken,
  decryptToken,
  storeMicrosoftTokens,
  getMicrosoftAccessToken,
  refreshMicrosoftToken,
  getOnBehalfOfToken,
};
