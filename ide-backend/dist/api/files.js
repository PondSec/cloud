import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { HttpError } from '../utils/http-error.js';
import { resolveWorkspacePath, toPosixPath } from '../utils/safe-path.js';
import { requireWorkspace, workspaceRootPath } from '../workspace/service.js';
const readSchema = z.object({ path: z.string().default('') });
const writeSchema = z.object({ path: z.string().min(1), content: z.string() });
const createSchema = z.object({ path: z.string().min(1), type: z.enum(['file', 'directory']).default('file') });
const renameSchema = z.object({ fromPath: z.string().min(1), toPath: z.string().min(1) });
export const fileRouter = Router();
fileRouter.use(requireAuth);
fileRouter.get('/:workspaceId/list', async (req, res, next) => {
    try {
        const parsed = readSchema.safeParse(req.query);
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid path query');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const root = workspaceRootPath(workspace.id);
        const targetDir = resolveWorkspacePath(root, parsed.data.path);
        const stat = await fs.stat(targetDir).catch(() => null);
        if (!stat || !stat.isDirectory()) {
            throw new HttpError(404, 'Directory not found');
        }
        const entries = await fs.readdir(targetDir, { withFileTypes: true });
        const nodes = [];
        for (const entry of entries) {
            const absolute = path.join(targetDir, entry.name);
            const s = await fs.stat(absolute);
            const rel = path.relative(root, absolute);
            nodes.push({
                path: toPosixPath(rel),
                name: entry.name,
                type: entry.isDirectory() ? 'directory' : 'file',
                size: s.size,
                mtimeMs: s.mtimeMs,
            });
        }
        nodes.sort((a, b) => a.name.localeCompare(b.name));
        res.json({ items: nodes });
    }
    catch (error) {
        next(error);
    }
});
fileRouter.get('/:workspaceId/read', async (req, res, next) => {
    try {
        const parsed = readSchema.safeParse(req.query);
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid path query');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const root = workspaceRootPath(workspace.id);
        const absolute = resolveWorkspacePath(root, parsed.data.path);
        const stat = await fs.stat(absolute).catch(() => null);
        if (!stat || !stat.isFile()) {
            throw new HttpError(404, 'File not found');
        }
        const content = await fs.readFile(absolute, 'utf8');
        res.json({ content });
    }
    catch (error) {
        next(error);
    }
});
fileRouter.put('/:workspaceId/write', async (req, res, next) => {
    try {
        const parsed = writeSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid payload');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const root = workspaceRootPath(workspace.id);
        const absolute = resolveWorkspacePath(root, parsed.data.path);
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, parsed.data.content, 'utf8');
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
fileRouter.post('/:workspaceId/create', async (req, res, next) => {
    try {
        const parsed = createSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid payload');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const root = workspaceRootPath(workspace.id);
        const absolute = resolveWorkspacePath(root, parsed.data.path);
        if (parsed.data.type === 'directory') {
            await fs.mkdir(absolute, { recursive: true });
        }
        else {
            await fs.mkdir(path.dirname(absolute), { recursive: true });
            await fs.writeFile(absolute, '', { flag: 'wx' }).catch(async (error) => {
                if (error.code === 'EEXIST') {
                    throw new HttpError(409, 'File already exists');
                }
                throw error;
            });
        }
        res.status(201).json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
fileRouter.patch('/:workspaceId/rename', async (req, res, next) => {
    try {
        const parsed = renameSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid payload');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const root = workspaceRootPath(workspace.id);
        const from = resolveWorkspacePath(root, parsed.data.fromPath);
        const to = resolveWorkspacePath(root, parsed.data.toPath);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.rename(from, to);
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
fileRouter.delete('/:workspaceId/delete', async (req, res, next) => {
    try {
        const parsed = readSchema.safeParse(req.query);
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid path query');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const root = workspaceRootPath(workspace.id);
        const target = resolveWorkspacePath(root, parsed.data.path);
        await fs.rm(target, { recursive: true, force: true });
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
