import path from 'node:path';
export function resolveWorkspacePath(workspaceRoot, relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    const cleaned = normalized.startsWith('/') ? normalized.slice(1) : normalized;
    const full = path.resolve(workspaceRoot, cleaned);
    const root = path.resolve(workspaceRoot);
    if (full !== root && !full.startsWith(`${root}${path.sep}`)) {
        throw new Error('Path traversal attempt blocked');
    }
    return full;
}
export function toPosixPath(value) {
    return value.replace(/\\/g, '/');
}
