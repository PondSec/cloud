import fs from 'node:fs/promises';
import path from 'node:path';

import { config } from '../config.js';
import { runCommand } from '../utils/process.js';

const startLocks = new Map<string, Promise<{ containerName: string; started: boolean }>>();

export function workspaceContainerName(workspaceId: string): string {
  return `cloudide-ws-${workspaceId.replace(/[^a-zA-Z0-9_.-]/g, '-')}`;
}

export function workspaceDir(workspaceId: string): string {
  return path.posix.join(config.workspacesRoot, workspaceId);
}

export function buildDockerRunArgs(args: {
  workspaceId: string;
  image: string;
  volumeName: string;
  cpuLimit: string;
  memLimit: string;
  pidsLimit: number;
  allowEgress: boolean;
  workspaceNetwork: string;
  seccompProfile?: string;
}): string[] {
  const containerName = workspaceContainerName(args.workspaceId);
  const workdir = `/workspaces/${args.workspaceId}`;

  const seccompProfile = (args.seccompProfile ?? config.runnerSeccompProfile).trim();

  const runArgs: string[] = [
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
  ];

  if (seccompProfile) {
    runArgs.push('--security-opt', `seccomp=${seccompProfile}`);
  }

  runArgs.push(
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
  );

  return runArgs;
}

export async function ensureWorkspaceDirectory(workspaceId: string): Promise<void> {
  await fs.mkdir(workspaceDir(workspaceId), { recursive: true });
}

export async function containerRunning(workspaceId: string): Promise<boolean> {
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

export async function containerExists(workspaceId: string): Promise<boolean> {
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

export async function startContainer(args: {
  workspaceId: string;
  image?: string;
  volumeName?: string;
  cpuLimit?: string;
  memLimit?: string;
  pidsLimit?: number;
  allowEgress?: boolean;
  workspaceNetwork?: string;
}): Promise<{ containerName: string; started: boolean }> {
  const inFlight = startLocks.get(args.workspaceId);
  if (inFlight) {
    return inFlight;
  }

  const request = startContainerInternal(args);
  startLocks.set(args.workspaceId, request);
  try {
    return await request;
  } finally {
    if (startLocks.get(args.workspaceId) === request) {
      startLocks.delete(args.workspaceId);
    }
  }
}

async function startContainerInternal(args: {
  workspaceId: string;
  image?: string;
  volumeName?: string;
  cpuLimit?: string;
  memLimit?: string;
  pidsLimit?: number;
  allowEgress?: boolean;
  workspaceNetwork?: string;
}): Promise<{ containerName: string; started: boolean }> {
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

  const startSpec = {
    workspaceId: args.workspaceId,
    image: args.image ?? config.workspaceImage,
    volumeName: args.volumeName ?? config.workspaceVolume,
    cpuLimit: args.cpuLimit ?? config.defaultCpuLimit,
    memLimit: args.memLimit ?? config.defaultMemLimit,
    pidsLimit: args.pidsLimit ?? config.defaultPidsLimit,
    allowEgress: args.allowEgress ?? config.defaultAllowEgress,
    workspaceNetwork: args.workspaceNetwork ?? config.workspaceNetwork,
  };

  const runArgs = buildDockerRunArgs(startSpec);
  let started = await runCommand(runArgs);

  if (
    started.exitCode !== 0 &&
    config.allowSeccompFallback &&
    config.runnerSeccompProfile.trim() &&
    isSeccompProfileUnavailable(`${started.stderr}\n${started.stdout}`)
  ) {
    const fallbackRunArgs = buildDockerRunArgs({
      ...startSpec,
      seccompProfile: '',
    });
    started = await runCommand(fallbackRunArgs);
  }

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

export async function stopContainer(workspaceId: string): Promise<void> {
  const containerName = workspaceContainerName(workspaceId);
  const result = await runCommand(['rm', '-f', containerName]);
  if (result.exitCode !== 0 && !result.stderr.includes('No such container')) {
    throw new Error(result.stderr || 'Failed to stop workspace container');
  }
}

export async function execInContainer(args: {
  workspaceId: string;
  cmd: string;
  cwd?: string;
  env?: Record<string, string>;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const containerName = workspaceContainerName(args.workspaceId);

  const execArgs: string[] = ['exec', '-i'];

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

export async function inspectContainerIp(workspaceId: string): Promise<string> {
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

export async function ensureWorkspaceImageBuilt(): Promise<void> {
  const inspect = await runCommand(['image', 'inspect', config.workspaceImage]);
  if (inspect.exitCode === 0) {
    return;
  }
  throw new Error(
    `Workspace image '${config.workspaceImage}' not found. Build it first (docker compose build workspace-image).`,
  );
}

function escapeShellPath(value: string): string {
  return `'${value.replace(/'/g, `"'"'`)}'`;
}

function isNoSuchContainer(output: string): boolean {
  return /No such object|No such container|No such file or directory/i.test(output);
}

function isContainerNameConflict(output: string): boolean {
  return /Conflict\.\s+The container name\b/i.test(output) || /is already in use by container/i.test(output);
}

function isSeccompProfileUnavailable(output: string): boolean {
  return /opening seccomp profile|seccomp profile.*failed|seccomp.+no such file or directory/i.test(output);
}
