import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockKvGet, mockKvSet, mockKvDel } = vi.hoisted(() => ({
  mockKvGet: vi.fn(),
  mockKvSet: vi.fn(),
  mockKvDel: vi.fn(),
}));

vi.mock('@vercel/kv', () => ({
  kv: {
    get: mockKvGet,
    set: mockKvSet,
    del: mockKvDel,
  }
}));

import { kvGet, kvSet, kvDel } from '@/lib/kv';

describe('kv helpers', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('get returns parsed JSON for JSON keys', async () => {
    mockKvGet.mockResolvedValue({ projects: ['id1'] });
    const result = await kvGet<{ projects: string[] }>('da_last_seen');
    expect(result).toEqual({ projects: ['id1'] });
  });

  it('get returns raw string for non-JSON keys', async () => {
    mockKvGet.mockResolvedValue('wa_recipient_value');
    const result = await kvGet<string>('wa_recipient');
    expect(result).toEqual('wa_recipient_value');
  });

  it('set stores value with expiry', async () => {
    await kvSet('test_key', { foo: 'bar' });
    expect(mockKvSet).toHaveBeenCalledWith('test_key', { foo: 'bar' }, { ex: 86400 });
  });

  it('del removes a key', async () => {
    await kvDel('test_key');
    expect(mockKvDel).toHaveBeenCalledWith('test_key');
  });
});
