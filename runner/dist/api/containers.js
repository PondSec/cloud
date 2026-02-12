import { Router } from 'express';
import { z } from 'zod';
import { containerRunning, execInContainer, startContainer, stopContainer, workspaceContainerName, } from '../services/docker.js';
const startSchema = z.object({
    workspaceId: z.string().min(1),
    image: z.string().optional(),
    volumeName: z.string().optional(),
    cpuLimit: z.string().optional(),
    memLimit: z.string().optional(),
    pidsLimit: z.number().int().optional(),
    allowEgress: z.boolean().optional(),
});
const execSchema = z.object({
    workspaceId: z.string().min(1),
    cmd: z.string().min(1),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
});
const stopSchema = z.object({ workspaceId: z.string().min(1) });
const ptySchema = z.object({
    workspaceId: z.string().min(1),
    shell: z.string().optional(),
});
export const containerRouter = Router();
containerRouter.post('/start', async (req, res, next) => {
    try {
        const parsed = startSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
            return;
        }
        const result = await startContainer(parsed.data);
        res.json(result);
    }
    catch (error) {
        next(error);
    }
});
containerRouter.post('/exec', async (req, res, next) => {
    try {
        const parsed = execSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
            return;
        }
        const result = await execInContainer(parsed.data);
        res.json(result);
    }
    catch (error) {
        next(error);
    }
});
containerRouter.get('/status', async (req, res, next) => {
    try {
        const workspaceId = typeof req.query.workspaceId === 'string' ? req.query.workspaceId : '';
        if (!workspaceId) {
            res.status(400).json({ error: 'workspaceId is required' });
            return;
        }
        const running = await containerRunning(workspaceId);
        res.json({ running, containerName: workspaceContainerName(workspaceId) });
    }
    catch (error) {
        next(error);
    }
});
containerRouter.post('/stop', async (req, res, next) => {
    try {
        const parsed = stopSchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
            return;
        }
        await stopContainer(parsed.data.workspaceId);
        res.json({ stopped: true });
    }
    catch (error) {
        next(error);
    }
});
containerRouter.post('/pty', async (req, res, next) => {
    try {
        const parsed = ptySchema.safeParse(req.body);
        if (!parsed.success) {
            res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload' });
            return;
        }
        await startContainer({ workspaceId: parsed.data.workspaceId });
        res.json({
            workspaceId: parsed.data.workspaceId,
            shell: parsed.data.shell ?? 'bash',
            wsPath: `/ws/pty?workspaceId=${encodeURIComponent(parsed.data.workspaceId)}`,
        });
    }
    catch (error) {
        next(error);
    }
});
containerRouter.post('/port/open', (req, res) => {
    const workspaceId = typeof req.body?.workspaceId === 'string' ? req.body.workspaceId : '';
    const port = Number(req.body?.port);
    if (!workspaceId || !Number.isInteger(port) || port <= 0 || port > 65535) {
        res.status(400).json({ error: 'Invalid workspaceId/port' });
        return;
    }
    // Reserved extension point: currently container networking allows internal listening by default.
    res.json({ opened: true, workspaceId, port });
});
