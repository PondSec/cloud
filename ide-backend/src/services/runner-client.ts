import { URL } from 'node:url';

import { config } from '../config.js';

interface RunnerExecResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runnerRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, config.runnerUrl).toString();
  const response = await fetch(url, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-runner-secret': config.runnerSharedSecret,
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Runner request failed (${response.status}): ${body}`);
  }

  return (await response.json()) as T;
}

export async function ensureWorkspaceContainer(args: {
  workspaceId: string;
  allowEgress: boolean;
}): Promise<void> {
  await runnerRequest('/containers/start', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId: args.workspaceId,
      image: config.workspaceImage,
      volumeName: config.workspaceVolume,
      workspacesRoot: config.workspacesRoot,
      allowEgress: args.allowEgress,
      cpuLimit: config.defaultCpuLimit,
      memLimit: config.defaultMemLimit,
      pidsLimit: config.defaultPidsLimit,
    }),
  });
}

export async function stopWorkspaceContainer(workspaceId: string): Promise<void> {
  await runnerRequest('/containers/stop', {
    method: 'POST',
    body: JSON.stringify({ workspaceId }),
  });
}

export async function runnerExec(args: {
  workspaceId: string;
  cmd: string;
  cwd?: string;
  env?: Record<string, string>;
}): Promise<RunnerExecResponse> {
  return runnerRequest<RunnerExecResponse>('/containers/exec', {
    method: 'POST',
    body: JSON.stringify(args),
  });
}

export async function runnerStatus(workspaceId: string): Promise<{ running: boolean; containerName: string }> {
  return runnerRequest<{ running: boolean; containerName: string }>(`/containers/status?workspaceId=${encodeURIComponent(workspaceId)}`);
}
