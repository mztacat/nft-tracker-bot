import { Context, NextFunction } from 'grammy';

const userCommandTimestamps = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_COMMANDS = 20;

export function rateLimitMiddleware(ctx: Context, next: NextFunction): Promise<void> {
  const from = ctx.from;
  if (!from) return next();

  const key = String(from.id);
  const now = Date.now();
  const timestamps = (userCommandTimestamps.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= MAX_COMMANDS) {
    return ctx.reply('⚠️ Too many requests. Please slow down and try again in a minute.').then(() => {});
  }

  timestamps.push(now);
  userCommandTimestamps.set(key, timestamps);
  return next();
}
