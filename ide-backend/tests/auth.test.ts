import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestContext, type TestContext } from './test-app.js';

let ctx: TestContext | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
  vi.resetModules();
});

describe('auth API', () => {
  it('registers and logs in', async () => {
    ctx = await createTestContext();

    const register = await request(ctx.app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'Password123!' });

    expect(register.status).toBe(201);
    expect(register.body.token).toBeTypeOf('string');

    const login = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'Password123!' });

    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('test@example.com');
  });
});
