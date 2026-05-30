import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { encrypt, decrypt } from './crypto';

const KEY = 'a'.repeat(64); // 32 bytes hex
let originalKey: string | undefined;

beforeAll(() => { originalKey = process.env.ENCRYPTION_KEY; process.env.ENCRYPTION_KEY = KEY; });
afterAll(() => { process.env.ENCRYPTION_KEY = originalKey; });

describe('crypto', () => {
  it('round-trips a plaintext value', () => {
    const plain = 'session_id=abc123; foo=bar';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  it('produces different ciphertext for the same plaintext (random nonce)', () => {
    const plain = 'same';
    expect(encrypt(plain)).not.toBe(encrypt(plain));
  });

  it('throws on tampered ciphertext (auth tag mismatch)', () => {
    const c = encrypt('hello');
    const [nonce, tag, ct] = c.split(':');
    const flippedCt = Buffer.from(ct, 'base64');
    flippedCt[0] ^= 0xff;
    const tampered = `${nonce}:${tag}:${flippedCt.toString('base64')}`;
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws clearly when ENCRYPTION_KEY is missing', () => {
    const saved = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      expect(() => encrypt('x')).toThrow(/ENCRYPTION_KEY/);
    } finally {
      process.env.ENCRYPTION_KEY = saved;
    }
  });
});
