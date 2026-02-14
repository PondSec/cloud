import { describe, expect, it, vi } from 'vitest';

import { requireRunnerSecret } from '../src/auth.js';

describe('requireRunnerSecret', () => {
  it('rejects requests without runner secret', () => {
    const req = { header: vi.fn().mockReturnValue(undefined) } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireRunnerSecret(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows requests with runner secret', () => {
    const req = { header: vi.fn().mockReturnValue('dev-runner-shared-secret-change-me') } as any;
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() } as any;
    const next = vi.fn();

    requireRunnerSecret(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
