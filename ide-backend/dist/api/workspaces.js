import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';
import { createWorkspaceForUser, listUserWorkspaces, readWorkspaceSettings, renameWorkspaceForUser, removeWorkspace, requireWorkspace, writeWorkspaceSettings, } from '../workspace/service.js';
import { ensureWorkspaceContainer, runnerStatus, stopWorkspaceContainer } from '../services/runner-client.js';
import { HttpError } from '../utils/http-error.js';
const createSchema = z.object({
    name: z.string().min(2).max(120),
    template: z.enum(['python', 'node-ts', 'c', 'web']).default('web'),
});
const renameSchema = z.object({
    name: z.string().min(2).max(120),
});
const settingsSchema = z.object({
    env: z.record(z.string()).default({}),
    commands: z
        .object({
        run: z.string().optional(),
        build: z.string().optional(),
        test: z.string().optional(),
        preview: z.string().optional(),
    })
        .default({}),
    previewPort: z.number().int().nonnegative().optional(),
    languageServers: z
        .record(z.boolean())
        .default({ typescript: true, python: true, c: true }),
    allowEgress: z.boolean().default(config.defaultAllowEgress),
});
const startLimiter = rateLimit({
    windowMs: config.runnerStartRateLimitWindowMs,
    max: config.runnerStartRateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
});
export const workspaceRouter = Router();
workspaceRouter.use(requireAuth);
workspaceRouter.get('/', (req, res) => {
    const items = listUserWorkspaces(req.auth.userId);
    res.json({ items });
});
workspaceRouter.post('/', async (req, res, next) => {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid payload');
        }
        const workspace = await createWorkspaceForUser({
            userId: req.auth.userId,
            name: parsed.data.name,
            template: parsed.data.template,
        });
        res.status(201).json({ workspace });
    }
    catch (error) {
        next(error);
    }
});
workspaceRouter.get('/:workspaceId', async (req, res, next) => {
    try {
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        const runtime = await runnerStatus(workspace.id).catch(() => ({ running: false, containerName: '' }));
        res.json({ workspace, settings, runtime });
    }
    catch (error) {
        next(error);
    }
});
workspaceRouter.patch('/:workspaceId', (req, res, next) => {
    try {
        const parsed = renameSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid payload');
        }
        const workspace = renameWorkspaceForUser(req.params.workspaceId, req.auth.userId, parsed.data.name);
        res.json({ workspace });
    }
    catch (error) {
        next(error);
    }
});
workspaceRouter.delete('/:workspaceId', async (req, res, next) => {
    try {
        await stopWorkspaceContainer(req.params.workspaceId).catch(() => undefined);
        await removeWorkspace(req.params.workspaceId, req.auth.userId);
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
workspaceRouter.get('/:workspaceId/settings', (req, res, next) => {
    try {
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        res.json({ settings });
    }
    catch (error) {
        next(error);
    }
});
workspaceRouter.put('/:workspaceId/settings', (req, res, next) => {
    try {
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const parsed = settingsSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid settings payload');
        }
        writeWorkspaceSettings(workspace.id, parsed.data);
        res.json({ settings: parsed.data });
    }
    catch (error) {
        next(error);
    }
});
workspaceRouter.post('/:workspaceId/start', startLimiter, async (req, res, next) => {
    try {
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        await ensureWorkspaceContainer({ workspaceId: workspace.id, allowEgress: settings.allowEgress });
        const status = await runnerStatus(workspace.id);
        res.json({ status });
    }
    catch (error) {
        next(error);
    }
});
workspaceRouter.post('/:workspaceId/stop', async (req, res, next) => {
    try {
        requireWorkspace(req.params.workspaceId, req.auth.userId);
        await stopWorkspaceContainer(req.params.workspaceId);
        res.json({ stopped: true });
    }
    catch (error) {
        next(error);
    }
});
