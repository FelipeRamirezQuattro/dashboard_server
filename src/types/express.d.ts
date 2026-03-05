import type { IUser } from "../models/User.model";
import type { JWTPayload } from "../utils/jwt.utils";
import type { Session, SessionData } from "express-session";

declare module "express-serve-static-core" {
  interface Request {
    jwtPayload?: JWTPayload;
    session: Session & Partial<SessionData>;
  }
}

declare global {
  namespace Express {
    interface User extends IUser {}
  }
}

export {};
