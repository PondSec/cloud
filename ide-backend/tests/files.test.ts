import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestContext, type TestContext } from './test-app.js';

let ctx: TestContext | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
  vi.resetModules();
});

async function registerAndToken(app: TestContext['app']): Promise<string> {
  const register = await request(app)
    .post('/api/auth/register')
    .send({ email: 'files@example.com', password: 'Password123!' });

  return register.body.token as string;
}

describe('file API', () => {
  it('creates, writes and reads files in workspace', async () => {
    ctx = await createTestContext();
    const token = await registerAndToken(ctx.app);

    const workspace = await request(ctx.app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ws', template: 'web' });

    expect(workspace.status).toBe(201);
    const workspaceId = workspace.body.workspace.id as string;

    const createFile = await request(ctx.app)
      .post(`/api/files/${workspaceId}/create`)
      .set('Authorization', `Bearer ${token}`)
      .send({ path: 'src/main.py', type: 'file' });
    expect(createFile.status).toBe(201);

    const write = await request(ctx.app)
      .put(`/api/files/${workspaceId}/write`)
      .set('Authorization', `Bearer ${token}`)
      .send({ path: 'src/main.py', content: 'print("ok")\n' });
    expect(write.status).toBe(200);

    const read = await request(ctx.app)
      .get(`/api/files/${workspaceId}/read`)
      .query({ path: 'src/main.py' })
      .set('Authorization', `Bearer ${token}`);
    expect(read.status).toBe(200);
    expect(read.body.content).toContain('print("ok")');

    const list = await request(ctx.app)
      .get(`/api/files/${workspaceId}/list`)
      .query({ path: 'src' })
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body.items[0].name).toBe('main.py');
  });
});
