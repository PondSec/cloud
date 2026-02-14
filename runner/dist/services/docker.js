import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { runCommand } from '../utils/process.js';
const startLocks = new Map();
export function workspaceContainerName(workspaceId) {
    return `cloudide-ws-${workspaceId.replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
}
export function workspaceDir(workspaceId) {
    return path.posix.join(config.workspacesRoot, workspaceId);
}
export function buildDockerRunArgs(args) {
    const containerName = workspaceContainerName(args.workspaceId);
    const workdir = `/workspaces/${args.workspaceId}`;
    return [
        'run',
        '-d',
        '--name',
        containerName,
        '--user',
        '1000:1000',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--security-opt',
        'seccomp=default',
        '--read-only',
        '--cpus',
        args.cpuLimit,
        '--memory',
        args.memLimit,
        '--pids-limit',
        String(args.pidsLimit),
        '--tmpfs',
        '/tmp:rw,noexec,nosuid,size=64m',
        '--mount',
        `type=volume,src=${args.volumeName},dst=/workspaces`,
        '--workdir',
        workdir,
        '--network',
        args.allowEgress ? args.workspaceNetwork : 'none',
        args.image,
        'sleep',
        'infinity',
    ];
}
export async function ensureWorkspaceDirectory(workspaceId) {
    await fs.mkdir(workspaceDir(workspaceId), { recursive: true });
}
export async function containerRunning(workspaceId) {
    const containerName = workspaceContainerName(workspaceId);
    const result = await runCommand(['inspect', '-f', '{{.State.Running}}', containerName]);
    if (result.exitCode === 0) {
        return result.stdout.trim() === 'true';
    }
    if (isNoSuchContainer(result.stderr) || isNoSuchContainer(result.stdout)) {
        return false;
    }
    throw new Error(result.stderr || result.stdout || 'Failed to inspect workspace container');
}
export async function containerExists(workspaceId) {
    const containerName = workspaceContainerName(workspaceId);
    const result = await runCommand(['inspect', containerName]);
    if (result.exitCode === 0) {
        return true;
    }
    if (isNoSuchContainer(result.stderr) || isNoSuchContainer(result.stdout)) {
        return false;
    }
    throw new Error(result.stderr || result.stdout || 'Failed to inspect workspace container');
}
export async function startContainer(args) {
    const inFlight = startLocks.get(args.workspaceId);
    if (inFlight) {
        return inFlight;
    }
    const request = startContainerInternal(args);
    startLocks.set(args.workspaceId, request);
    try {
        return await request;
    }
    finally {
        if (startLocks.get(args.workspaceId) === request) {
            startLocks.delete(args.workspaceId);
        }
    }
}
async function startContainerInternal(args) {
    await ensureWorkspaceDirectory(args.workspaceId);
    const containerName = workspaceContainerName(args.workspaceId);
    const exists = await containerExists(args.workspaceId);
    if (exists) {
        const running = await containerRunning(args.workspaceId);
        if (!running) {
            const started = await runCommand(['start', containerName]);
            if (started.exitCode !== 0) {
                throw new Error(started.stderr || 'Failed to start existing workspace container');
            }
        }
        return { containerName, started: !running };
    }
    const runArgs = buildDockerRunArgs({
        workspaceId: args.workspaceId,
        image: args.image ?? config.workspaceImage,
        volumeName: args.volumeName ?? config.workspaceVolume,
        cpuLimit: args.cpuLimit ?? config.defaultCpuLimit,
        memLimit: args.memLimit ?? config.defaultMemLimit,
        pidsLimit: args.pidsLimit ?? config.defaultPidsLimit,
        allowEgress: args.allowEgress ?? config.defaultAllowEgress,
        workspaceNetwork: args.workspaceNetwork ?? config.workspaceNetwork,
    });
    const started = await runCommand(runArgs);
    if (started.exitCode !== 0) {
        const combined = `${started.stderr}\n${started.stdout}`;
        if (isContainerNameConflict(combined)) {
            const running = await containerRunning(args.workspaceId);
            if (running) {
                return { containerName, started: false };
            }
            const resumed = await runCommand(['start', containerName]);
            if (resumed.exitCode === 0) {
                return { containerName, started: true };
            }
            throw new Error(resumed.stderr || resumed.stdout || started.stderr || started.stdout || 'Failed to recover workspace container');
        }
        throw new Error(started.stderr || started.stdout || 'Failed to run workspace container');
    }
    return { containerName, started: true };
}
export async function stopContainer(workspaceId) {
    const containerName = workspaceContainerName(workspaceId);
    const result = await runCommand(['rm', '-f', containerName]);
    if (result.exitCode !== 0 && !result.stderr.includes('No such container')) {
        throw new Error(result.stderr || 'Failed to stop workspace container');
    }
}
export async function execInContainer(args) {
    const containerName = workspaceContainerName(args.workspaceId);
    const execArgs = ['exec', '-i'];
    if (args.env) {
        for (const [key, value] of Object.entries(args.env)) {
            execArgs.push('-e', `${key}=${value}`);
        }
    }
    const shellCommand = args.cwd
        ? `cd ${escapeShellPath(args.cwd)} && ${args.cmd}`
        : `cd /workspaces/${args.workspaceId} && ${args.cmd}`;
    execArgs.push(containerName, 'sh', '-lc', shellCommand);
    const result = await runCommand(execArgs);
    return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
    };
}
export async function inspectContainerIp(workspaceId) {
    const containerName = workspaceContainerName(workspaceId);
    const result = await runCommand([
        'inspect',
        '-f',
        '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}',
        containerName,
    ]);
    if (result.exitCode !== 0) {
        throw new Error(result.stderr || 'Failed to inspect container ip');
    }
    const ip = result.stdout.trim();
    if (!ip) {
        throw new Error('Container has no IP address');
    }
    return ip;
}
export async function ensureWorkspaceImageBuilt() {
    const inspect = await runCommand(['image', 'inspect', config.workspaceImage]);
    if (inspect.exitCode === 0) {
        return;
    }
    throw new Error(`Workspace image '${config.workspaceImage}' not found. Build it first (docker compose build workspace-image).`);
}
function escapeShellPath(value) {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
}
function isNoSuchContainer(output) {
    return /No such object|No such container|No such file or directory/i.test(output);
}
function isContainerNameConflict(output) {
    return /Conflict\.\s+The container name\b/i.test(output) || /is already in use by container/i.test(output);
}
