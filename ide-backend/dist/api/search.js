import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { HttpError } from '../utils/http-error.js';
import { toPosixPath } from '../utils/safe-path.js';
import { requireWorkspace, workspaceRootPath } from '../workspace/service.js';
const fileSearchQuerySchema = z.object({
    q: z.string().default(''),
    limit: z.coerce.number().int().min(1).max(500).default(120),
});
const textSearchSchema = z.object({
    query: z.string().min(1).max(2000),
    isRegex: z.boolean().optional().default(false),
    caseSensitive: z.boolean().optional().default(false),
    wholeWord: z.boolean().optional().default(false),
    include: z.union([z.string(), z.array(z.string())]).optional(),
    exclude: z.union([z.string(), z.array(z.string())]).optional(),
    maxResults: z.number().int().min(1).max(5000).optional().default(500),
});
const DEFAULT_EXCLUDES = ['.git/**', 'node_modules/**', 'dist/**', 'build/**', '.next/**', 'coverage/**'];
const MAX_FILE_BYTES_FALLBACK = 2_000_000;
const fileIndexCache = new Map();
export const searchRouter = Router();
searchRouter.use(requireAuth);
searchRouter.get('/:workspaceId/files', async (req, res, next) => {
    try {
        const parsed = fileSearchQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            throw new HttpError(400, 'Invalid query');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const root = workspaceRootPath(workspace.id);
        const q = parsed.data.q.trim();
        const limit = parsed.data.limit;
        // UI shows recents on empty query; avoid expensive indexing when unnecessary.
        if (!q) {
            const emptyResponse = { items: [] };
            res.json(emptyResponse);
            return;
        }
        const index = await getWorkspaceFileIndex(workspace.id, root);
        const results = rankFiles(index, q, limit);
        const response = { items: results };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
searchRouter.post('/:workspaceId/text', async (req, res, next) => {
    try {
        const parsed = textSearchSchema.safeParse(req.body);
        if (!parsed.success) {
            throw new HttpError(400, parsed.error.issues[0]?.message ?? 'Invalid payload');
        }
        const workspace = requireWorkspace(req.params.workspaceId, req.auth.userId);
        const root = workspaceRootPath(workspace.id);
        const include = normalizeGlobList(parsed.data.include);
        const exclude = normalizeGlobList(parsed.data.exclude);
        const { items, truncated } = await searchText({
            root,
            query: parsed.data.query,
            isRegex: parsed.data.isRegex,
            caseSensitive: parsed.data.caseSensitive,
            wholeWord: parsed.data.wholeWord,
            include,
            exclude,
            maxResults: parsed.data.maxResults,
        });
        const response = { items, truncated };
        res.json(response);
    }
    catch (error) {
        next(error);
    }
});
function normalizeGlobList(value) {
    if (!value)
        return [];
    const raw = Array.isArray(value) ? value : value.split(',').map((part) => part.trim());
    return raw.map((item) => item.trim()).filter(Boolean);
}
async function getWorkspaceFileIndex(workspaceId, root) {
    const now = Date.now();
    const cached = fileIndexCache.get(workspaceId);
    if (cached && cached.expiresAt > now) {
        return cached.files;
    }
    const files = await listFilesPreferRipgrep(root);
    fileIndexCache.set(workspaceId, { expiresAt: now + 10_000, files });
    return files;
}
async function listFilesPreferRipgrep(root) {
    try {
        const rgFiles = await runRipgrepFiles(root);
        if (rgFiles.length) {
            return rgFiles;
        }
    }
    catch (error) {
        // fall back
        if (!isSpawnMissingBinary(error)) {
            // ignore: we'll fall back to fs walk
        }
    }
    const out = [];
    await walkFiles(root, '', out);
    out.sort((a, b) => a.localeCompare(b));
    return out;
}
async function walkFiles(root, relDir, out) {
    const absDir = path.join(root, relDir);
    let entries;
    try {
        entries = await fs.readdir(absDir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const relPath = relDir ? path.posix.join(relDir, entry.name) : entry.name;
        const relPosix = toPosixPath(relPath);
        if (shouldExcludePath(relPosix)) {
            continue;
        }
        let stat = null;
        try {
            stat = await fs.lstat(path.join(root, relPosix));
        }
        catch {
            stat = null;
        }
        if (!stat)
            continue;
        if (stat.isSymbolicLink())
            continue;
        if (entry.isDirectory()) {
            await walkFiles(root, relPosix, out);
            continue;
        }
        if (entry.isFile()) {
            out.push(relPosix);
        }
    }
}
function shouldExcludePath(relPosix) {
    const normalized = relPosix.replace(/^\.?\//, '');
    for (const ex of DEFAULT_EXCLUDES) {
        const prefix = ex.replace('/**', '').replace(/^\//, '');
        if (!prefix)
            continue;
        if (normalized === prefix)
            return true;
        if (normalized.startsWith(`${prefix}/`))
            return true;
    }
    return false;
}
async function runRipgrepFiles(root) {
    const args = ['--files', '--color', 'never'];
    for (const ex of DEFAULT_EXCLUDES) {
        args.push('-g', `!${ex}`);
    }
    const { stdout } = await spawnCapture('rg', args, { cwd: root, maxStdoutBytes: 4_000_000 });
    const files = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((p) => normalizeRelPath(p));
    return files.filter((p) => !shouldExcludePath(p));
}
function rankFiles(files, query, limit) {
    const q = query.trim().toLowerCase();
    if (!q)
        return [];
    const scored = [];
    for (const file of files) {
        const score = fuzzyScore(file, q);
        if (score === null)
            continue;
        scored.push({ path: file, score });
    }
    scored.sort((a, b) => {
        if (b.score !== a.score)
            return b.score - a.score;
        return a.path.localeCompare(b.path);
    });
    return scored.slice(0, limit).map((item) => item.path);
}
function fuzzyScore(candidate, q) {
    const hay = candidate.toLowerCase();
    // Fast path: substring matches first.
    const substrIndex = hay.indexOf(q);
    if (substrIndex !== -1) {
        // Prefer earlier matches and shorter paths.
        return 10_000 - substrIndex * 10 - Math.min(hay.length, 500);
    }
    // Fuzzy: all chars must appear in order.
    let lastIdx = -1;
    let gaps = 0;
    let firstIdx = -1;
    for (const ch of q) {
        const idx = hay.indexOf(ch, lastIdx + 1);
        if (idx === -1)
            return null;
        if (firstIdx === -1)
            firstIdx = idx;
        gaps += Math.max(0, idx - lastIdx - 1);
        lastIdx = idx;
    }
    const span = lastIdx - firstIdx + 1;
    // Prefer compact spans and fewer gaps.
    return 2_000 - span * 5 - gaps * 3 - Math.min(hay.length, 500);
}
async function searchText(args) {
    try {
        return await searchTextWithRipgrep(args);
    }
    catch (error) {
        if (!isSpawnMissingBinary(error)) {
            // fall back for any execution/parsing errors too, but prefer surfacing real mistakes
        }
        return await searchTextFallback(args);
    }
}
async function searchTextWithRipgrep(args) {
    const rgArgs = ['--json', '--color', 'never', '--max-filesize', '2M'];
    if (!args.isRegex) {
        rgArgs.push('-F');
    }
    if (!args.caseSensitive) {
        rgArgs.push('-i');
    }
    if (args.wholeWord) {
        rgArgs.push('-w');
    }
    for (const ex of DEFAULT_EXCLUDES) {
        rgArgs.push('-g', `!${ex}`);
    }
    for (const g of args.exclude) {
        rgArgs.push('-g', `!${g}`);
    }
    for (const g of args.include) {
        rgArgs.push('-g', g);
    }
    rgArgs.push(args.query);
    rgArgs.push('.');
    const child = spawn('rg', rgArgs, { cwd: args.root, stdio: ['ignore', 'pipe', 'pipe'] });
    const items = [];
    let truncated = false;
    let stdoutBuffer = '';
    let stderr = '';
    const stop = () => {
        if (child.exitCode === null) {
            child.kill('SIGTERM');
        }
    };
    const processLine = (line) => {
        if (!line.trim())
            return;
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch {
            return;
        }
        if (msg.type !== 'match')
            return;
        const data = msg.data;
        if (!data?.path?.text || typeof data?.line_number !== 'number' || !data?.lines?.text)
            return;
        const rawPath = String(data.path.text);
        const relPath = normalizeRelPath(path.isAbsolute(rawPath) ? path.relative(args.root, rawPath) : rawPath);
        const rawLine = String(data.lines.text);
        const preview = rawLine.replace(/\r?\n$/, '');
        const lineNo = data.line_number;
        const submatches = Array.isArray(data.submatches) ? data.submatches : [];
        for (const sm of submatches) {
            if (!sm || typeof sm.start !== 'number' || !sm.match?.text)
                continue;
            const column = byteOffsetToColumn(rawLine, sm.start);
            items.push({
                path: relPath,
                line: lineNo,
                column,
                preview,
                match: String(sm.match.text),
            });
            if (items.length >= args.maxResults) {
                truncated = true;
                stop();
                return;
            }
        }
    };
    const done = new Promise((resolve, reject) => {
        child.stdout.on('data', (chunk) => {
            stdoutBuffer += chunk.toString('utf8');
            while (true) {
                const idx = stdoutBuffer.indexOf('\n');
                if (idx === -1)
                    break;
                const line = stdoutBuffer.slice(0, idx);
                stdoutBuffer = stdoutBuffer.slice(idx + 1);
                processLine(line);
            }
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (err) => reject(err));
        child.on('close', (code) => {
            if (stdoutBuffer.trim()) {
                processLine(stdoutBuffer);
            }
            if (code === 0 || truncated) {
                resolve({ items, truncated });
                return;
            }
            // ripgrep uses exit code 1 for "no matches"
            if (code === 1) {
                resolve({ items: [], truncated: false });
                return;
            }
            reject(new Error(stderr.trim() || `ripgrep failed (exit ${code ?? 'unknown'})`));
        });
    });
    return done;
}
function byteOffsetToColumn(line, byteOffset) {
    const buf = Buffer.from(line, 'utf8');
    const safe = Math.max(0, Math.min(byteOffset, buf.length));
    const prefix = buf.subarray(0, safe).toString('utf8');
    return prefix.length + 1;
}
async function searchTextFallback(args) {
    const files = await listFilesPreferRipgrep(args.root);
    const filtered = files.filter((p) => {
        if (shouldExcludePath(p))
            return false;
        for (const ex of args.exclude) {
            if (p.includes(ex.replace('/**', '')))
                return false;
        }
        for (const inc of args.include) {
            // naive include filter
            const prefix = inc.replace('/**', '').replace(/^\//, '');
            if (prefix && !p.startsWith(prefix))
                return false;
        }
        return true;
    });
    const items = [];
    const flags = args.caseSensitive ? 'g' : 'gi';
    let matcher = null;
    try {
        if (args.isRegex) {
            const base = args.wholeWord ? `\\b(?:${args.query})\\b` : args.query;
            matcher = new RegExp(base, flags);
        }
        else {
            const escaped = escapeRegExp(args.query);
            const base = args.wholeWord ? `\\b${escaped}\\b` : escaped;
            matcher = new RegExp(base, flags);
        }
    }
    catch (error) {
        throw new HttpError(400, `Invalid regex: ${error?.message || String(error)}`);
    }
    for (const rel of filtered) {
        if (items.length >= args.maxResults) {
            return { items, truncated: true };
        }
        const abs = path.join(args.root, rel);
        let stat = null;
        try {
            stat = await fs.stat(abs);
        }
        catch {
            stat = null;
        }
        if (!stat || !stat.isFile())
            continue;
        if (stat.size > MAX_FILE_BYTES_FALLBACK)
            continue;
        let content;
        try {
            content = await fs.readFile(abs, 'utf8');
        }
        catch {
            continue;
        }
        if (content.includes('\u0000'))
            continue;
        const lines = content.replace(/\r\n/g, '\n').split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? '';
            if (!matcher)
                continue;
            matcher.lastIndex = 0;
            let m;
            while ((m = matcher.exec(line)) !== null) {
                items.push({
                    path: toPosixPath(rel),
                    line: i + 1,
                    column: (m.index ?? 0) + 1,
                    preview: line,
                    match: m[0] ?? '',
                });
                if (items.length >= args.maxResults) {
                    return { items, truncated: true };
                }
                if (m.index === matcher.lastIndex) {
                    matcher.lastIndex++;
                }
            }
        }
    }
    return { items, truncated: false };
}
function escapeRegExp(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
async function spawnCapture(bin, args, options) {
    const child = spawn(bin, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    const done = new Promise((resolve, reject) => {
        child.stdout.on('data', (chunk) => {
            const text = chunk.toString('utf8');
            stdoutBytes += Buffer.byteLength(text, 'utf8');
            if (stdoutBytes <= options.maxStdoutBytes) {
                stdout += text;
            }
            if (stdoutBytes > options.maxStdoutBytes) {
                child.kill('SIGTERM');
            }
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString('utf8');
        });
        child.on('error', (err) => reject(err));
        child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    });
    const result = await done;
    if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(result.stderr || result.stdout || `${bin} failed`);
    }
    return result;
}
function isSpawnMissingBinary(error) {
    return (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ENOENT');
}
function normalizeRelPath(value) {
    return toPosixPath(value).replace(/^\.\/+/, '');
}
