import { z } from 'zod';

export interface ContactInput { name: string; contact: string; message: string }

export class ContactError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; this.name = 'ContactError'; }
}

export type ValidateResult = { kind: 'ok'; input: ContactInput } | { kind: 'honeypot' };

const schema = z.object({
  name:    z.string().trim().min(1).max(80),
  contact: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(1000),
  company: z.string().optional(), // honeypot — real users never fill it
});

export function validateContact(body: unknown): ValidateResult {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ContactError(parsed.error.issues.map(i => i.message).join('; '));
  if (parsed.data.company && parsed.data.company.trim().length > 0) return { kind: 'honeypot' };
  const { name, contact, message } = parsed.data;
  return { kind: 'ok', input: { name, contact, message } };
}

const WINDOW_MS = 3_600_000;
const LIMIT = 3;
const hits = new Map<string, number[]>();

/** Per-IP sliding-window limiter (in-process, matches the single-instance model). */
export function checkRateLimit(ip: string, now: number = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter(t => now - t < WINDOW_MS);
  if (recent.length >= LIMIT) { hits.set(ip, recent); return false; }
  recent.push(now);
  hits.set(ip, recent);
  return true;
}

export function formatContactMessage(i: ContactInput): string {
  return `📨 *New access request*\n\n*Name:* ${i.name}\n*Contact:* ${i.contact}\n\n${i.message}`;
}
