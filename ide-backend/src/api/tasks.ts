import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../auth/middleware.js';
import { ensureWorkspaceContainer, runnerExec } from '../services/runner-client.js';
import { readWorkspaceSettings, requireWorkspace } from '../workspace/service.js';
import { HttpError } from '../utils/http-error.js';

const runTaskSchema = z.object({
  task: z.enum(['run', 'build', 'test', 'preview', 'custom']),
  command: z.string().optional(),
});

export const taskRouter = Router();
taskRouter.use(requireAuth);

taskRouter.post('/:workspaceId/tasks/run', async (req, res, next) => {
  try {
    const parsed = runTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid task payload');
    }

    const workspace = requireWorkspace(req.params.workspaceId, req.auth!.userId);
    const settings = readWorkspaceSettings(workspace.id);
    await ensureWorkspaceContainer({ workspaceId: workspace.id, allowEgress: settings.allowEgress });

    const command =
      parsed.data.task === 'custom'
        ? parsed.data.command ?? ''
        : settings.commands[parsed.data.task === 'preview' ? 'preview' : parsed.data.task] ?? '';

    if (!command) {
      throw new HttpError(400, `No command configured for task '${parsed.data.task}'`);
    }

    const result = await runnerExec({
      workspaceId: workspace.id,
      cmd: command,
      env: settings.env,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});
