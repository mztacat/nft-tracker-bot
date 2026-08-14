import { prisma } from '../db/client.js';

const SCOPE = 'snooze';
const KEY = 'until';

export const SNOOZE_DURATIONS: Record<string, { label: string; ms: number | null }> = {
  '1h':  { label: '1 Hour',  ms: 60 * 60_000 },
  '6h':  { label: '6 Hours', ms: 6 * 60 * 60_000 },
  '1d':  { label: '1 Day',   ms: 24 * 60 * 60_000 },
  'off': { label: 'Muted',   ms: null }, // null = indefinite
};

/** Snooze all alerts for a tracked item for the given duration key. */
export async function snoozeItem(itemId: number, durationKey: string): Promise<void> {
  const dur = SNOOZE_DURATIONS[durationKey];
  if (!dur) throw new Error(`Unknown snooze duration: ${durationKey}`);

  const value = dur.ms === null
    ? 'forever'
    : new Date(Date.now() + dur.ms).toISOString();

  await prisma.settings.upsert({
    where: { scope_scopeId_key: { scope: SCOPE, scopeId: String(itemId), key: KEY } },
    create: { scope: SCOPE, scopeId: String(itemId), key: KEY, value },
    update: { value },
  });
}

/** Remove any snooze for a tracked item (re-enable alerts). */
export async function unsnoozeItem(itemId: number): Promise<void> {
  await prisma.settings.deleteMany({
    where: { scope: SCOPE, scopeId: String(itemId), key: KEY },
  });
}

/** Returns true if alerts for this item are currently snoozed. */
export async function isItemSnoozed(itemId: number): Promise<boolean> {
  const row = await prisma.settings.findUnique({
    where: { scope_scopeId_key: { scope: SCOPE, scopeId: String(itemId), key: KEY } },
  });
  if (!row) return false;
  if (row.value === 'forever') return true;
  const until = new Date(row.value);
  if (isNaN(until.getTime())) return false;
  if (Date.now() < until.getTime()) return true;

  // Expired — clean up
  await prisma.settings.deleteMany({
    where: { scope: SCOPE, scopeId: String(itemId), key: KEY },
  }).catch(() => {});
  return false;
}

/** Describe current snooze status for display. */
export async function getSnoozeStatus(itemId: number): Promise<string | null> {
  const row = await prisma.settings.findUnique({
    where: { scope_scopeId_key: { scope: SCOPE, scopeId: String(itemId), key: KEY } },
  });
  if (!row) return null;
  if (row.value === 'forever') return 'Muted (indefinite)';
  const until = new Date(row.value);
  if (isNaN(until.getTime()) || Date.now() >= until.getTime()) return null;
  return `Until ${until.toUTCString().replace(/:\d{2} GMT$/, ' UTC')}`;
}

/** Build the snooze inline keyboard row to attach to any alert. */
export function buildSnoozeKeyboard(itemId: number) {
  return {
    inline_keyboard: [[
      { text: '🕐 1H',  callback_data: `snooze:1h:${itemId}` },
      { text: '🕕 6H',  callback_data: `snooze:6h:${itemId}` },
      { text: '📅 1D',  callback_data: `snooze:1d:${itemId}` },
      { text: '🔕 Mute', callback_data: `snooze:off:${itemId}` },
    ]],
  };
}
