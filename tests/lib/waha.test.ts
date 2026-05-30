import { describe, it, expect, vi } from 'vitest';

const mockPost = vi.fn();
vi.stubGlobal('fetch', mockPost);

import { WahaClient } from '@/lib/waha';

describe('WahaClient', () => {
  it('sends text message to correct endpoint', async () => {
    mockPost.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    });

    const client = new WahaClient('http://localhost:3001', 'test-key');
    const result = await client.sendText('6281234567890', 'Hello!');

    expect(result).toBe(true);
    expect(mockPost).toHaveBeenCalledWith(
      'http://localhost:3001/api/sendText',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'x-api-key': 'test-key',
        }),
        body: JSON.stringify({
          session: 'default',
          chatId: '6281234567890@c.us',
          text: 'Hello!',
        }),
      })
    );
  });

  it('returns false on non-OK HTTP response', async () => {
    mockPost.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'rate_limited' }),
    });

    const client = new WahaClient('http://localhost:3001');
    const result = await client.sendText('6281234567890', 'Test');

    expect(result).toBe(false);
  });

  it('returns false when fetch throws', async () => {
    mockPost.mockRejectedValueOnce(new Error('network down'));

    const client = new WahaClient('http://localhost:3001');
    const result = await client.sendText('6281234567890', 'Test');

    expect(result).toBe(false);
  });
});
