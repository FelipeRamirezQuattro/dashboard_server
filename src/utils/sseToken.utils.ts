import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

interface SseTokenPayload {
  userId: string;
  type: "sse";
  iat?: number;
  exp?: number;
}

export const generateSseToken = (userId: string): string => {
  return jwt.sign(
    { userId, type: "sse" },
    env.jwtSecret,
    { expiresIn: "15m" } as SignOptions,
  );
};

export const verifySseToken = (token: string): string => {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as SseTokenPayload;
    if (payload.type !== "sse") {
      throw new Error("Invalid token type");
    }
    return payload.userId;
  } catch {
    throw new Error("Invalid or expired SSE token");
  }
};
