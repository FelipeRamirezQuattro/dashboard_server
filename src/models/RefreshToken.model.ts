import mongoose, { Schema, Document } from "mongoose";
import bcrypt from "bcryptjs";

export interface IRefreshToken extends Document {
  userId: mongoose.Types.ObjectId;
  token: string; // Hashed token
  expiresAt: Date;
  createdAt: Date;
  compareToken(candidateToken: string): Promise<boolean>;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    token: {
      type: String,
      required: true,
      select: false,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
);

// Index for automatic cleanup of expired tokens
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Method to compare token
refreshTokenSchema.methods.compareToken = async function (
  candidateToken: string,
): Promise<boolean> {
  return bcrypt.compare(candidateToken, this.token);
};

// Hash token before saving
refreshTokenSchema.pre("save", async function (next) {
  if (!this.isModified("token")) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.token = await bcrypt.hash(this.token, salt);
    next();
  } catch (error) {
    next(error as Error);
  }
});

// Transform output
refreshTokenSchema.set("toJSON", {
  transform: (_doc, ret: any) => {
    delete ret.token;
    delete ret.__v;
    return ret;
  },
});

const RefreshToken = mongoose.model<IRefreshToken>(
  "RefreshToken",
  refreshTokenSchema,
);

export default RefreshToken;
