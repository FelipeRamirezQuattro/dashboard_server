import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";

export type UserRole = "viewer" | "editor" | "admin" | "superadmin";

export interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash?: string;
  role: UserRole;
  microsoftId?: string;
  msAccessToken?: string;
  msRefreshToken?: string;
  msTokenExpiry?: Date;
  isActive: boolean;
  lastLogin?: Date;
  createdAt: Date;
  updatedAt: Date;
  comparePassword(candidatePassword: string): Promise<boolean>;
  getFullName(): string;
}

const userSchema = new Schema<IUser>(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      select: false, // Don't return password hash by default
    },
    role: {
      type: String,
      enum: ["viewer", "editor", "admin", "superadmin"],
      default: "viewer",
    },
    microsoftId: {
      type: String,
      sparse: true,
      unique: true,
      index: true,
    },
    msAccessToken: {
      type: String,
      select: false, // Encrypted token, don't return by default
    },
    msRefreshToken: {
      type: String,
      select: false,
    },
    msTokenExpiry: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

// Index for efficient queries
userSchema.index({ email: 1, isActive: 1 });
userSchema.index({ microsoftId: 1 });

// Virtual for full name
userSchema.virtual("fullName").get(function () {
  return `${this.firstName} ${this.lastName}`;
});

// Method to compare password
userSchema.methods.comparePassword = async function (
  candidatePassword: string,
): Promise<boolean> {
  if (!this.passwordHash) {
    return false;
  }
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Method to get full name
userSchema.methods.getFullName = function (): string {
  return `${this.firstName} ${this.lastName}`;
};

// Hash password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("passwordHash") || !this.passwordHash) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// Transform output to remove sensitive data
userSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret: any) => {
    delete ret.passwordHash;
    delete ret.msAccessToken;
    delete ret.msRefreshToken;
    delete ret.__v;
    return ret;
  },
});

const User = mongoose.model<IUser>("User", userSchema);

export default User;
