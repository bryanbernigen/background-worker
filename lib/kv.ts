import { kv } from '@vercel/kv';

export async function kvGet<T>(key: string): Promise<T | null> {
  const val = await kv.get<T>(key);
  return val ?? null;
}

export async function kvSet(key: string, value: unknown, exSeconds = 86400): Promise<void> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await kv.set(key, serialized, { ex: exSeconds });
}

export async function kvDel(key: string): Promise<void> {
  await kv.del(key);
}
