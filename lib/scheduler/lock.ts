// Uses pg session-level advisory locks. Caller must use a dedicated client
// (checked out via pool.connect) so the lock binds to that session.
// Locks auto-release on session close (process crash safety).
import type { PoolClient } from 'pg';
import { pool } from '@/lib/db/client';

export async function withJobLock<T>(
  jobId: number,
  fn: (client: PoolClient) => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const client = await pool.connect();
  try {
    const r = await client.query<{ ok: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS ok', [jobId],
    );
    if (!r.rows[0].ok) return { acquired: false };
    try {
      const value = await fn(client);
      return { acquired: true, value };
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [jobId]);
    }
  } finally {
    client.release();
  }
}
