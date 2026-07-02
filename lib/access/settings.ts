import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { appSettings } from '@/lib/db/schema';

// Values are wrapped as `{ v: <value> }` before storage. Drizzle's jsonb treats
// a raw string input as pre-serialized JSON (so '628…' would become a JSON
// *number* and lose leading zeros); wrapping in an object forces correct
// JSON serialization and round-trips every scalar type faithfully.
async function getSetting(key: string): Promise<unknown> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  if (!row) return undefined;
  return (row.value as { v?: unknown } | null)?.v;
}

async function setSetting(key: string, value: unknown): Promise<void> {
  const wrapped = { v: value };
  await db.insert(appSettings)
    .values({ key, value: wrapped, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: wrapped, updatedAt: new Date() } });
}

export async function getStringSetting(key: string): Promise<string | null> {
  const v = await getSetting(key);
  return typeof v === 'string' && v.length > 0 ? v : null;
}
export async function setStringSetting(key: string, value: string | null): Promise<void> {
  if (value === null || value === '') {
    await db.delete(appSettings).where(eq(appSettings.key, key));
    return;
  }
  await setSetting(key, value);
}

/** Guest mode defaults to ON when the setting has never been written. */
export function guestModeFromValue(v: unknown): boolean {
  if (v === undefined || v === null) return true;
  return v === true;
}

export async function isGuestModeEnabled(): Promise<boolean> {
  return guestModeFromValue(await getSetting('guest_mode'));
}
export async function setGuestMode(on: boolean): Promise<void> {
  await setSetting('guest_mode', on);
}
export async function getAdminContactPhone(): Promise<string | null> {
  const v = await getSetting('admin_contact_phone');
  return typeof v === 'string' && v.length > 0 ? v : null;
}
export async function setAdminContactPhone(phone: string | null): Promise<void> {
  // `value` is NOT NULL — clearing means removing the row (read defaults to null).
  if (phone === null) {
    await db.delete(appSettings).where(eq(appSettings.key, 'admin_contact_phone'));
    return;
  }
  await setSetting('admin_contact_phone', phone);
}
