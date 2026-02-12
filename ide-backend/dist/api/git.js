import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { ensureWorkspaceContainer, runnerExec } from '../services/runner-client.js';
import { credentialForRemote, injectCredentialIntoUrl, removeGitCredential, saveGitCredential, } from '../services/git-credentials.js';
import { readWorkspaceSettings, requireWorkspace } from '../workspace/service.js';
import { HttpError } from '../utils/http-error.js';
const cloneSchema = z.object({ url: z.string().url(), branch: z.string().optional() });
const commitSchema = z.object({ message: z.string().min(1).max(300) });
const stageSchema = z.object({ path: z.string().min(1) });
const checkoutSchema = z.object({ branch: z.string().min(1), create: z.boolean().default(false) });
const credentialSchema = z.object({ host: z.string().min(1), username: z.string().min(1), token: z.string().min(1) });
async function runGit(args) {
    await ensureWorkspaceContainer({ workspaceId: args.workspaceId, allowEgress: args.allowEgress });
    const result = await runnerExec({ workspaceId: args.workspaceId, cmd: args.cmd, env: args.env });
    if (result.exitCode !== 0) {
        throw new HttpError(400, result.stderr || `Git command failed: ${args.cmd}`);
    }
    return result;
}
export const gitRouter = Router();
gitRouter.use(requireAuth);
gitRouter.post('/:workspaceId/git/init', async (req, res, next) => {
    try {
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        await runGit({ workspaceId: workspace.id, allowEgress: settings.allowEgress, cmd: 'git init' });
        res.json({ ok: true, allowEgress: settings.allowEgress });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.post('/:workspaceId/git/clone', async (req, res, next) => {
    try {
        const parsed = cloneSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid clone payload');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        let cloneUrl = parsed.data.url;
        const credential = credentialForRemote(workspace.id, cloneUrl);
        if (credential) {
            cloneUrl = injectCredentialIntoUrl(cloneUrl, credential);
        }
        const cmd = parsed.data.branch
            ? `git clone --branch ${shellEscape(parsed.data.branch)} ${shellEscape(cloneUrl)} .`
            : `git clone ${shellEscape(cloneUrl)} .`;
        await ensureWorkspaceContainer({ workspaceId: workspace.id, allowEgress: settings.allowEgress });
        const result = await runnerExec({ workspaceId: workspace.id, cmd });
        if (result.exitCode !== 0) {
            throw new HttpError(400, result.stderr || result.stdout || 'Clone failed');
        }
        res.json({ stdout: result.stdout });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.get('/:workspaceId/git/status', async (req, res, next) => {
    try {
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        const result = await runGit({
            workspaceId: workspace.id,
            allowEgress: settings.allowEgress,
            cmd: 'git status --porcelain=v1 -b',
        });
        res.json({ output: result.stdout });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.get('/:workspaceId/git/diff', async (req, res, next) => {
    try {
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        const file = typeof req.query.path === 'string' ? req.query.path : '';
        const cmd = file ? `git diff -- ${shellEscape(file)}` : 'git diff';
        const result = await runGit({ workspaceId: workspace.id, allowEgress: settings.allowEgress, cmd });
        res.json({ output: result.stdout });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.post('/:workspaceId/git/stage', async (req, res, next) => {
    try {
        const parsed = stageSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid stage payload');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        await runGit({
            workspaceId: workspace.id,
            allowEgress: settings.allowEgress,
            cmd: `git add -- ${shellEscape(parsed.data.path)}`,
        });
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.post('/:workspaceId/git/unstage', async (req, res, next) => {
    try {
        const parsed = stageSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid unstage payload');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        await runGit({
            workspaceId: workspace.id,
            allowEgress: settings.allowEgress,
            cmd: `git reset HEAD -- ${shellEscape(parsed.data.path)}`,
        });
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.post('/:workspaceId/git/commit', async (req, res, next) => {
    try {
        const parsed = commitSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid commit payload');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        await runGit({
            workspaceId: workspace.id,
            allowEgress: settings.allowEgress,
            cmd: `git commit -m ${shellEscape(parsed.data.message)}`,
        });
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.get('/:workspaceId/git/branches', async (req, res, next) => {
    try {
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        const result = await runGit({
            workspaceId: workspace.id,
            allowEgress: settings.allowEgress,
            cmd: 'git branch --all --verbose --no-abbrev',
        });
        res.json({ output: result.stdout });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.post('/:workspaceId/git/checkout', async (req, res, next) => {
    try {
        const parsed = checkoutSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid checkout payload');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        const cmd = parsed.data.create
            ? `git checkout -b ${shellEscape(parsed.data.branch)}`
            : `git checkout ${shellEscape(parsed.data.branch)}`;
        await runGit({ workspaceId: workspace.id, allowEgress: settings.allowEgress, cmd });
        res.json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.post('/:workspaceId/git/pull', async (req, res, next) => {
    try {
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        const remoteUrl = (await runGit({
            workspaceId: workspace.id,
            allowEgress: settings.allowEgress,
            cmd: 'git remote get-url origin',
        })).stdout.trim();
        const credential = credentialForRemote(workspace.id, remoteUrl);
        let cmd = 'git pull';
        if (credential) {
            cmd = `git pull ${shellEscape(injectCredentialIntoUrl(remoteUrl, credential))}`;
        }
        const result = await runGit({ workspaceId: workspace.id, allowEgress: settings.allowEgress, cmd });
        res.json({ output: result.stdout });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.post('/:workspaceId/git/push', async (req, res, next) => {
    try {
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const settings = readWorkspaceSettings(workspace.id);
        const remoteUrl = (await runGit({
            workspaceId: workspace.id,
            allowEgress: settings.allowEgress,
            cmd: 'git remote get-url origin',
        })).stdout.trim();
        const credential = credentialForRemote(workspace.id, remoteUrl);
        let cmd = 'git push';
        if (credential) {
            cmd = `git push ${shellEscape(injectCredentialIntoUrl(remoteUrl, credential))}`;
        }
        const result = await runGit({ workspaceId: workspace.id, allowEgress: settings.allowEgress, cmd });
        res.json({ output: result.stdout });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.post('/:workspaceId/git/credentials', (req, res, next) => {
    try {
        const parsed = credentialSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid credential payload');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        saveGitCredential({
            workspaceId: workspace.id,
            host: parsed.data.host,
            username: parsed.data.username,
            token: parsed.data.token,
        });
        res.status(201).json({ ok: true });
    }
    catch (error) {
        next(error);
    }
});
gitRouter.delete('/:workspaceId/git/credentials', (req, res, next) => {
    try {
        const host = typeof req.query.host === 'string' ? req.query.host.trim() : '';
        if (!host) {
            throw new HttpError(400, 'host query is required');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        removeGitCredential(workspace.id, host);
        res.status(204).send();
    }
    catch (error) {
        next(error);
    }
});
function shellEscape(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
