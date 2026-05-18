import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function kvGet<T>(key: string): Promise<T | null> {
  const val = await redis.get<T>(key);
  return val ?? null;
}

export async function kvSet(key: string, value: unknown, exSeconds = 86400): Promise<void> {
  await redis.set(key, value, { ex: exSeconds });
}

export async function kvDel(key: string): Promise<void> {
  await redis.del(key);
}
