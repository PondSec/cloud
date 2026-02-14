import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestContext, type TestContext } from './test-app.js';

let ctx: TestContext | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
  vi.resetModules();
});

async function registerToken(app: TestContext['app'], email: string): Promise<string> {
  const response = await request(app).post('/api/auth/register').send({ email, password: 'Password123!' });
  expect(response.status).toBe(201);
  return response.body.token as string;
}

describe('workspace authorization boundaries', () => {
  it('prevents cross-tenant workspace/file access', async () => {
    ctx = await createTestContext();
    const aliceToken = await registerToken(ctx.app, 'alice-idor@example.com');
    const bobToken = await registerToken(ctx.app, 'bob-idor@example.com');

    const ws = await request(ctx.app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ name: 'Alice WS', template: 'python' });
    expect(ws.status).toBe(201);
    const workspaceId = ws.body.workspace.id as string;

    const bobRead = await request(ctx.app)
      .get(`/api/workspaces/${workspaceId}`)
      .set('Authorization', `Bearer ${bobToken}`);
    expect(bobRead.status).toBe(404);

    const bobWrite = await request(ctx.app)
      .put(`/api/files/${workspaceId}/write`)
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ path: 'stolen.txt', content: 'x' });
    expect(bobWrite.status).toBe(404);
  });

  it('rejects malformed workspace id values', async () => {
    ctx = await createTestContext();
    const token = await registerToken(ctx.app, 'mallory@example.com');

    const response = await request(ctx.app)
      .get('/api/workspaces/not-a-valid-workspace-id')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
  });
});
