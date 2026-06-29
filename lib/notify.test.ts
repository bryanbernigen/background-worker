import { describe, it, expect, vi } from 'vitest';
import { buildNotifier } from './notify';
import type { Recipient } from '@/lib/jobs/types';

const recips: Recipient[] = [
  { id: 1, name: 'A', phone: '111', tag: 'new-task' },
  { id: 2, name: 'B', phone: '222', tag: 'cookie-expiry' },
  { id: 3, name: 'C', phone: '333', tag: 'new-task' },
];

describe('buildNotifier', () => {
  it('sends to all recipients when no tag given', async () => {
    const sendText = vi.fn().mockResolvedValue(true);
    const notify = buildNotifier(recips, { sendText });
    const sent = await notify('hi');
    expect(sent).toBe(true);
    expect(sendText).toHaveBeenCalledTimes(3);
  });

  it('filters recipients by tag', async () => {
    const sendText = vi.fn().mockResolvedValue(true);
    const notify = buildNotifier(recips, { sendText });
    await notify('hi', { tag: 'new-task' });
    expect(sendText.mock.calls.map(c => c[0])).toEqual(['111', '333']);
  });

  it('returns false and does not throw when channel is null', async () => {
    const notify = buildNotifier(recips, null);
    expect(await notify('hi')).toBe(false);
  });

  it('keeps going if one send throws, returns true if any succeeded', async () => {
    const sendText = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(true);
    const notify = buildNotifier(recips.filter(r => r.tag === 'new-task'), { sendText });
    expect(await notify('hi', { tag: 'new-task' })).toBe(true);
    expect(sendText).toHaveBeenCalledTimes(2);
  });
});
