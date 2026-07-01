import { describe, it, expect } from 'vitest';
import { maskName, maskPhone, maskRecipient, maskRunDetail, maskJobCustom } from './mask';

describe('maskName', () => {
  it('keeps first and last char', () => {
    expect(maskName('Bryan')).toBe('B***n');
  });
  it('masks fully for <=2 chars', () => {
    expect(maskName('Al')).toBe('**');
    expect(maskName('A')).toBe('*');
    expect(maskName('')).toBe('*');
  });
});

describe('maskPhone', () => {
  it('keeps the last 4 digits', () => {
    expect(maskPhone('+62 812-3456-7890')).toBe('••••7890');
  });
  it('masks fully when <=4 digits', () => {
    expect(maskPhone('123')).toBe('***');
  });
});

describe('maskRecipient', () => {
  const r = { id: 1, name: 'Bryan', phone: '628123456789', tag: 'new-task' };
  it('admin -> unchanged', () => { expect(maskRecipient('admin', r)).toEqual(r); });
  it('guest -> name+phone masked', () => {
    const m = maskRecipient('guest', r);
    expect(m.name).toBe('B***n');
    expect(m.phone).toBe('••••6789');
    expect(m.tag).toBe('new-task');
  });
});

describe('maskRunDetail', () => {
  const row = { id: 1, status: 'ok', summary: 's', data: { x: 1 }, rawHtml: '<x>', errorMessage: 'e' };
  it('admin -> unchanged', () => { expect(maskRunDetail('admin', row)).toEqual(row); });
  it('guest -> drops data/rawHtml/errorMessage', () => {
    const m = maskRunDetail('guest', row) as Record<string, unknown>;
    expect(m.summary).toBe('s');
    expect('data' in m).toBe(false);
    expect('rawHtml' in m).toBe(false);
    expect('errorMessage' in m).toBe(false);
  });
});

describe('maskJobCustom', () => {
  it('admin keeps, guest omits', () => {
    expect(maskJobCustom('admin', { a: 1 })).toEqual({ a: 1 });
    expect(maskJobCustom('guest', { a: 1 })).toBeUndefined();
  });
});
