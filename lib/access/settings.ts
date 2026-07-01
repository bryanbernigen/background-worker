import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { appSettings } from '@/lib/db/schema';

async function getSetting(key: string): Promise<unknown> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return row?.value;
}

async function setSetting(key: string, value: unknown): Promise<void> {
  await db.insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
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
  await setSetting('admin_contact_phone', phone);
}
