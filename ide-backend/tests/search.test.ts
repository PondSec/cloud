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
    .send({ email: 'search@example.com', password: 'Password123!' });

  return register.body.token as string;
}

describe('search API', () => {
  it('searches files and text in a workspace', async () => {
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
      .send({ path: 'src/main.py', content: 'print(\"ok\")\\n' });
    expect(write.status).toBe(200);

    const fileSearch = await request(ctx.app)
      .get(`/api/search/${workspaceId}/files`)
      .query({ q: 'main', limit: 50 })
      .set('Authorization', `Bearer ${token}`);
    expect(fileSearch.status).toBe(200);
    expect(Array.isArray(fileSearch.body.items)).toBe(true);
    expect(fileSearch.body.items).toContain('src/main.py');

    const textSearch = await request(ctx.app)
      .post(`/api/search/${workspaceId}/text`)
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'print' });
    expect(textSearch.status).toBe(200);
    expect(Array.isArray(textSearch.body.items)).toBe(true);
    expect(textSearch.body.items.length).toBeGreaterThan(0);
    expect(textSearch.body.items[0].path).toBe('src/main.py');
  });

  it('returns 400 for invalid regex', async () => {
    ctx = await createTestContext();
    const token = await registerAndToken(ctx.app);

    const workspace = await request(ctx.app)
      .post('/api/workspaces')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ws', template: 'web' });
    expect(workspace.status).toBe(201);
    const workspaceId = workspace.body.workspace.id as string;

    const bad = await request(ctx.app)
      .post(`/api/search/${workspaceId}/text`)
      .set('Authorization', `Bearer ${token}`)
      .send({ query: '(', isRegex: true });

    expect(bad.status).toBe(400);
  });
});

