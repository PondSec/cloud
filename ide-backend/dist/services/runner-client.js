import { URL } from 'node:url';
import { config } from '../config.js';
async function runnerRequest(path, init) {
    const url = new URL(path, config.runnerUrl).toString();
    const response = await fetch(url, {
        ...init,
        headers: {
            'content-type': 'application/json',
            ...(init?.headers ?? {}),
        },
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Runner request failed (${response.status}): ${body}`);
    }
    return (await response.json());
}
export async function ensureWorkspaceContainer(args) {
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
export async function stopWorkspaceContainer(workspaceId) {
    await runnerRequest('/containers/stop', {
        method: 'POST',
        body: JSON.stringify({ workspaceId }),
    });
}
export async function runnerExec(args) {
    return runnerRequest('/containers/exec', {
        method: 'POST',
        body: JSON.stringify(args),
    });
}
export async function runnerStatus(workspaceId) {
    return runnerRequest(`/containers/status?workspaceId=${encodeURIComponent(workspaceId)}`);
}
