import { URL } from 'node:url';

import { Router } from 'express';

import { inspectContainerIp, startContainer } from '../services/docker.js';

export const previewRouter = Router();

async function proxyToContainer(req: any, res: any, workspaceId: string, port: string, suffix: string): Promise<void> {
  await startContainer({ workspaceId });
  const ip = await inspectContainerIp(workspaceId);

  const target = new URL(`http://${ip}:${port}/${suffix}`);
  for (const [key, value] of Object.entries(req.query)) {
    if (typeof value === 'string') {
      target.searchParams.set(key, value);
    }
  }

  const headers: Record<string, string> = {
    accept: req.headers.accept ?? '*/*',
  };
  const userAgent = req.headers['user-agent'];
  if (typeof userAgent === 'string') {
    headers['user-agent'] = userAgent;
  }

  const upstream = await fetch(target.toString(), {
    method: req.method,
    headers,
  });

  res.status(upstream.status);
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'transfer-encoding') return;
    res.setHeader(key, value);
  });

  if (!upstream.body) {
    res.end();
    return;
  }

  const reader = upstream.body.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    res.write(Buffer.from(chunk.value));
  }
  res.end();
}

previewRouter.all('/:workspaceId/:port', async (req, res) => {
  try {
    await proxyToContainer(req, res, req.params.workspaceId, req.params.port, '');
  } catch (error) {
    res.status(502).json({ error: 'Preview proxy failed', detail: String(error) });
  }
});

previewRouter.all('/:workspaceId/:port/*', async (req, res) => {
  try {
    const wildcard = (req.params as Record<string, string | undefined>)['0'] ?? '';
    await proxyToContainer(req, res, req.params.workspaceId, req.params.port, wildcard);
  } catch (error) {
    res.status(502).json({ error: 'Preview proxy failed', detail: String(error) });
  }
});
