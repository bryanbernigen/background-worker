import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDel = vi.fn();

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn(() => ({
    get: mockGet,
    set: mockSet,
    del: mockDel,
  })),
}));

import { kvGet, kvSet, kvDel } from '@/lib/kv';

describe('kv helpers', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('get returns value', async () => {
    mockGet.mockResolvedValue({ projects: ['id1'] });
    const result = await kvGet<{ projects: string[] }>('da_last_seen');
    expect(result).toEqual({ projects: ['id1'] });
    expect(mockGet).toHaveBeenCalledWith('da_last_seen');
  });

  it('get returns null when not found', async () => {
    mockGet.mockResolvedValue(null);
    const result = await kvGet<string>('missing_key');
    expect(result).toBeNull();
  });

  it('set stores value with expiry', async () => {
    await kvSet('test_key', { foo: 'bar' });
    expect(mockSet).toHaveBeenCalledWith('test_key', { foo: 'bar' }, { ex: 86400 });
  });

  it('del removes a key', async () => {
    await kvDel('test_key');
    expect(mockDel).toHaveBeenCalledWith('test_key');
  });
});
