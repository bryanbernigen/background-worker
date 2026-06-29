import { describe, it, expect } from 'vitest';
import type { JobModule, RunResult, RunContext } from './types';

describe('generic job contract', () => {
  it('a module conforms with type + run() returning status/summary', async () => {
    const mod: JobModule = {
      type: 'demo',
      defaultMeta: { title: 'Demo', url: 'https://example.com', description: 'x' },
      async run(_ctx: RunContext): Promise<RunResult> {
        return { status: 'ok', summary: 'did a thing', data: { n: 1 }, notificationSent: false };
      },
    };
    expect(mod.type).toBe('demo');
    const res = await mod.run({} as RunContext);
    expect(res.status).toBe('ok');
    expect(res.summary).toBe('did a thing');
    expect((res.data as { n: number }).n).toBe(1);
  });
});
