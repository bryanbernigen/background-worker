import { describe, it, expect } from 'vitest';
import { resolveWaha, maskSecret, apiKeyPatchAction } from './waha-config';

describe('resolveWaha', () => {
  it('DB value wins', () => { expect(resolveWaha('https://db', 'https://env')).toBe('https://db'); });
  it('falls back to env when DB unset/empty', () => {
    expect(resolveWaha(null, 'https://env')).toBe('https://env');
    expect(resolveWaha('', 'https://env')).toBe('https://env');
    expect(resolveWaha(undefined, 'https://env')).toBe('https://env');
  });
  it('null when neither set', () => { expect(resolveWaha(null, undefined)).toBeNull(); });
});

describe('maskSecret', () => {
  it('masks long secrets front/back', () => { expect(maskSecret('abcdefghijklmnop')).toBe('abcd…mnop (16 chars)'); });
  it('fully masks short secrets', () => { expect(maskSecret('abc')).toBe('***'); });
});

describe('apiKeyPatchAction', () => {
  it('keeps when omitted', () => { expect(apiKeyPatchAction(undefined)).toBe('keep'); });
  it('clears on null or empty', () => {
    expect(apiKeyPatchAction(null)).toBe('clear');
    expect(apiKeyPatchAction('')).toBe('clear');
  });
  it('sets on a value', () => { expect(apiKeyPatchAction('secret')).toEqual({ set: 'secret' }); });
});
