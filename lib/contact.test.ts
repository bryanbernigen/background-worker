import { describe, it, expect } from 'vitest';
import { validateContact, checkRateLimit, formatContactMessage, ContactError } from './contact';

describe('validateContact', () => {
  const good = { name: 'Ann', contact: 'ann@x.com', message: 'hi there' };
  it('accepts good input', () => {
    expect(validateContact(good)).toEqual({ kind: 'ok', input: good });
  });
  it('trims and rejects empties', () => {
    expect(() => validateContact({ ...good, name: '   ' })).toThrow(ContactError);
    expect(() => validateContact({ ...good, message: '' })).toThrow(ContactError);
  });
  it('rejects over-long fields', () => {
    expect(() => validateContact({ ...good, message: 'x'.repeat(1001) })).toThrow(ContactError);
  });
  it('treats a filled honeypot as honeypot (no throw)', () => {
    expect(validateContact({ ...good, company: 'spam' })).toEqual({ kind: 'honeypot' });
  });
});

describe('checkRateLimit', () => {
  it('allows 3 then blocks the 4th within the window', () => {
    const ip = 'test-ip-a'; const t = 1_000_000;
    expect(checkRateLimit(ip, t)).toBe(true);
    expect(checkRateLimit(ip, t + 1)).toBe(true);
    expect(checkRateLimit(ip, t + 2)).toBe(true);
    expect(checkRateLimit(ip, t + 3)).toBe(false);
  });
  it('frees up after the window passes', () => {
    const ip = 'test-ip-b'; const t = 5_000_000;
    checkRateLimit(ip, t); checkRateLimit(ip, t); checkRateLimit(ip, t);
    expect(checkRateLimit(ip, t + 3_600_001)).toBe(true);
  });
});

describe('formatContactMessage', () => {
  it('includes all fields', () => {
    const msg = formatContactMessage({ name: 'Ann', contact: 'a@x.com', message: 'hello' });
    expect(msg).toContain('Ann'); expect(msg).toContain('a@x.com'); expect(msg).toContain('hello');
  });
});
