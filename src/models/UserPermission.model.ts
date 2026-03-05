import mongoose, { Schema, Document } from "mongoose";

export type PermissionLevel = "businessUnit" | "department" | "application";

export interface IUserPermission extends Document {
  userId: mongoose.Types.ObjectId;
  permissionLevel: PermissionLevel;
  businessUnitId?: mongoose.Types.ObjectId;
  departmentId?: mongoose.Types.ObjectId;
  applicationId?: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const userPermissionSchema = new Schema<IUserPermission>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    permissionLevel: {
      type: String,
      enum: ["businessUnit", "department", "application"],
      required: true,
    },
    businessUnitId: {
      type: Schema.Types.ObjectId,
      ref: "BusinessUnit",
      sparse: true,
    },
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "Department",
      sparse: true,
    },
    applicationId: {
      type: Schema.Types.ObjectId,
      ref: "ExternalApp",
      sparse: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Indexes for efficient queries
userPermissionSchema.index({ userId: 1 });
userPermissionSchema.index({ userId: 1, permissionLevel: 1 });
userPermissionSchema.index({ userId: 1, businessUnitId: 1 });
userPermissionSchema.index({ userId: 1, departmentId: 1 });
userPermissionSchema.index({ userId: 1, applicationId: 1 });

// Validation: Ensure correct fields are set based on permission level
userPermissionSchema.pre("save", function (next) {
  if (this.permissionLevel === "businessUnit" && !this.businessUnitId) {
    return next(
      new Error(
        "businessUnitId is required for businessUnit level permissions",
      ),
    );
  }
  if (
    this.permissionLevel === "department" &&
    (!this.departmentId || !this.businessUnitId)
  ) {
    return next(
      new Error(
        "departmentId and businessUnitId are required for department level permissions",
      ),
    );
  }
  if (
    this.permissionLevel === "application" &&
    (!this.applicationId || !this.departmentId || !this.businessUnitId)
  ) {
    return next(
      new Error(
        "applicationId, departmentId, and businessUnitId are required for application level permissions",
      ),
    );
  }
  next();
});

// Transform output
userPermissionSchema.set("toJSON", {
  transform: (_doc, ret: any) => {
    delete ret.__v;
    return ret;
  },
});

const UserPermission = mongoose.model<IUserPermission>(
  "UserPermission",
  userPermissionSchema,
);

export default UserPermission;
