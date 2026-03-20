import mongoose, { Document, Schema } from "mongoose";

export interface IConversationTurn {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

export interface IConversation extends Document {
  userId: mongoose.Types.ObjectId;
  sessionId: string;
  turns: IConversationTurn[];
  createdAt: Date;
  updatedAt: Date;
}

const conversationTurnSchema = new Schema<IConversationTurn>(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const conversationSchema = new Schema<IConversation>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    turns: {
      type: [conversationTurnSchema],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

conversationSchema.index({ userId: 1, sessionId: 1 }, { unique: true });

const Conversation = mongoose.model<IConversation>(
  "Conversation",
  conversationSchema,
);

export default Conversation;
