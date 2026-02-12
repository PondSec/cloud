import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Express } from 'express';

export interface TestContext {
  app: Express;
  cleanup: () => void;
}

export async function createTestContext(): Promise<TestContext> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudide-backend-'));
  const dbPath = path.join(tempRoot, 'test.db');
  const wsRoot = path.join(tempRoot, 'workspaces');

  process.env.DB_PATH = dbPath;
  process.env.WORKSPACES_ROOT = wsRoot;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.APP_ENCRYPTION_KEY = 'test-encryption-key';

  const { createAppServer } = await import('../src/app.js');
  const { app } = createAppServer();

  return {
    app,
    cleanup: () => {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    },
  };
}
