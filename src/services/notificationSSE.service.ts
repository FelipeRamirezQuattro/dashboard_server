import { Response } from "express";
import logger from "../utils/logger";

// In-memory registry: userId -> set of active SSE response objects
const clients = new Map<string, Set<Response>>();

export const registerClient = (userId: string, res: Response): void => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  if (!clients.has(userId)) {
    clients.set(userId, new Set());
  }
  clients.get(userId)!.add(res);

  // Send initial heartbeat so the client knows the connection is live
  res.write(
    `event: connected\ndata: ${JSON.stringify({ connected: true })}\n\n`,
  );

  // Keep-alive ping every 25 seconds to prevent proxy timeouts
  const keepAlive = setInterval(() => {
    res.write(": ping\n\n");
  }, 25000);

  res.on("close", () => {
    clearInterval(keepAlive);
    const userClients = clients.get(userId);
    if (userClients) {
      userClients.delete(res);
      if (userClients.size === 0) {
        clients.delete(userId);
      }
    }
    logger.debug(`SSE client disconnected: ${userId}`);
  });

  logger.debug(`SSE client registered: ${userId}`);
};

export const broadcast = (payload: Record<string, unknown>): void => {
  const data = JSON.stringify(payload);
  clients.forEach((userClients) => {
    userClients.forEach((res) => {
      res.write(`event: message\ndata: ${data}\n\n`);
    });
  });
};

export const sendToUser = (
  userId: string,
  payload: Record<string, unknown>,
): void => {
  const userClients = clients.get(userId);
  if (!userClients) return;
  const data = JSON.stringify(payload);
  userClients.forEach((res) => {
    res.write(`event: message\ndata: ${data}\n\n`);
  });
};

export const getConnectedClientCount = (): number => {
  let count = 0;
  clients.forEach((userClients) => {
    count += userClients.size;
  });
  return count;
};
