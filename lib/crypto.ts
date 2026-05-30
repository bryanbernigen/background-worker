import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALG = 'aes-256-gcm';
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const k = process.env.ENCRYPTION_KEY;
  if (!k) throw new Error('ENCRYPTION_KEY is not set');
  if (k.length !== 64) throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  return Buffer.from(k, 'hex');
}

/** Encrypt a UTF-8 string. Returns `base64(nonce):base64(tag):base64(ciphertext)`. */
export function encrypt(plaintext: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv(ALG, key(), nonce);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${nonce.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** Decrypt the format produced by `encrypt`. Throws on tampering, missing key, malformed input. */
export function decrypt(packed: string): string {
  const parts = packed.split(':');
  if (parts.length !== 3) throw new Error('Malformed ciphertext');
  const [nonceB64, tagB64, ctB64] = parts;
  const nonce = Buffer.from(nonceB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ct = Buffer.from(ctB64, 'base64');
  if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('Malformed ciphertext');
  }
  const decipher = createDecipheriv(ALG, key(), nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
