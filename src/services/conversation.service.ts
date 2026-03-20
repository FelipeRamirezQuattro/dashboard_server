import Conversation from "../models/Conversation.model";

export interface ContextTurn {
  role: "user" | "assistant";
  content: string;
}

const MAX_STORED_TURNS = 100;

export const getConversationHistory = async (
  userId: string,
  sessionId: string,
  limit: number = 12,
): Promise<ContextTurn[]> => {
  const conversation = await Conversation.findOne({ userId, sessionId }).lean();

  if (!conversation || !conversation.turns?.length) {
    return [];
  }

  return conversation.turns.slice(-limit).map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));
};

export const appendConversationTurns = async (
  userId: string,
  sessionId: string,
  turns: ContextTurn[],
): Promise<void> => {
  if (!turns.length) return;

  await Conversation.updateOne(
    { userId, sessionId },
    {
      $setOnInsert: { userId, sessionId },
      $push: {
        turns: {
          $each: turns.map((turn) => ({
            role: turn.role,
            content: turn.content,
            timestamp: new Date(),
          })),
          $slice: -MAX_STORED_TURNS,
        },
      },
    },
    { upsert: true },
  );
};
