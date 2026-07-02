import { WahaClient } from '@/lib/waha';
import { encrypt, decrypt } from '@/lib/crypto';
import type { NotificationChannel } from '@/lib/notify';
import { getStringSetting, setStringSetting } from '@/lib/access/settings';

type Source = 'db' | 'env' | 'none';

const KEY_URL = 'waha_url';
const KEY_APIKEY = 'waha_api_key_encrypted';
const KEY_SESSION = 'waha_session';

/** DB value wins when non-empty; else env; else null. Pure. */
export function resolveWaha(dbVal: string | null | undefined, envVal: string | undefined): string | null {
  if (dbVal && dbVal.length > 0) return dbVal;
  if (envVal && envVal.length > 0) return envVal;
  return null;
}

/** Masked preview of a secret — `front4…back4 (N chars)`, or all `*` when short. Pure. */
export function maskSecret(s: string): string {
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-4)} (${s.length} chars)`;
}

/** What a PATCH should do with an incoming apiKey field. Pure. */
export function apiKeyPatchAction(incoming: string | null | undefined): 'keep' | 'clear' | { set: string } {
  if (incoming === undefined) return 'keep';
  if (incoming === null || incoming === '') return 'clear';
  return { set: incoming };
}

async function urlWithSource(): Promise<[string | null, Source]> {
  const dbVal = await getStringSetting(KEY_URL);
  if (dbVal) return [dbVal, 'db'];
  const env = process.env.WAHA_URL;
  return env ? [env, 'env'] : [null, 'none'];
}

async function apiKeyWithSource(): Promise<[string, Source]> {
  const enc = await getStringSetting(KEY_APIKEY);
  if (enc) { try { return [decrypt(enc), 'db']; } catch { /* fall through to env */ } }
  const env = process.env.WAHA_API_KEY;
  return env ? [env, 'env'] : ['', 'none'];
}

export async function getWahaConfig(): Promise<{ url: string | null; apiKey: string; session: string }> {
  const [url] = await urlWithSource();
  const [apiKey] = await apiKeyWithSource();
  const session = resolveWaha(await getStringSetting(KEY_SESSION), process.env.WAHA_SESSION) ?? 'default';
  return { url, apiKey, session };
}

export async function getWahaChannel(): Promise<NotificationChannel | null> {
  const { url, apiKey } = await getWahaConfig();
  if (!url) return null;
  const waha = new WahaClient(url, apiKey);
  return { sendText: (to, msg) => waha.sendText(to, msg) };
}

export async function wahaConfigStatus(): Promise<{
  configured: boolean; url: string | null; urlSource: Source;
  apiKeyPreview: string | null; apiKeySource: Source; session: string;
}> {
  const [url, urlSource] = await urlWithSource();
  const [apiKey, apiKeySource] = await apiKeyWithSource();
  const session = resolveWaha(await getStringSetting(KEY_SESSION), process.env.WAHA_SESSION) ?? 'default';
  return {
    configured: !!url,
    url, urlSource,
    apiKeyPreview: apiKey ? maskSecret(apiKey) : null,
    apiKeySource,
    session,
  };
}

/** Apply a settings PATCH to the WAHA config rows. */
export async function applyWahaPatch(patch: { wahaUrl?: string | null; wahaApiKey?: string | null; wahaSession?: string | null }): Promise<void> {
  if (patch.wahaUrl !== undefined) await setStringSetting(KEY_URL, patch.wahaUrl);
  if (patch.wahaSession !== undefined) await setStringSetting(KEY_SESSION, patch.wahaSession);
  const action = apiKeyPatchAction(patch.wahaApiKey);
  if (action === 'clear') await setStringSetting(KEY_APIKEY, null);
  else if (action !== 'keep') await setStringSetting(KEY_APIKEY, encrypt(action.set));
}
