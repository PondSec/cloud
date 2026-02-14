import { afterEach, describe, expect, it, vi } from 'vitest';

import { runnerStatus } from '../src/services/runner-client.js';

describe('runner client auth header', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends x-runner-secret to runner', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ running: true, containerName: 'abc' }),
    } as Response);

    await runnerStatus('workspace-1');

    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({
      'x-runner-secret': 'dev-runner-shared-secret-change-me',
    });
  });
});
