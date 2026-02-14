function env(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export const config = {
  nodeEnv: env('NODE_ENV', 'development'),
  port: envInt('PORT', 8081),
  dockerBin: env('DOCKER_BIN', 'docker'),
  workspaceImage: env('WORKSPACE_IMAGE', 'cloudide-workspace:latest'),
  workspaceVolume: env('WORKSPACE_VOLUME', 'cloudide-workspaces'),
  workspaceNetwork: env('WORKSPACE_NETWORK', 'bridge'),
  workspacesRoot: env('WORKSPACES_ROOT', '/workspaces'),
  defaultCpuLimit: env('DEFAULT_CPU_LIMIT', '1'),
  defaultMemLimit: env('DEFAULT_MEM_LIMIT', '1024m'),
  defaultPidsLimit: envInt('DEFAULT_PIDS_LIMIT', 256),
  defaultAllowEgress: envBool('DEFAULT_ALLOW_EGRESS', true),
  runnerSeccompProfile: env('RUNNER_SECCOMP_PROFILE', 'default'),
  allowSeccompFallback: envBool('RUNNER_ALLOW_SECCOMP_FALLBACK', true),
  runnerSharedSecret: env('RUNNER_SHARED_SECRET', 'dev-runner-shared-secret-change-me'),
  workspaceImageContext: env('WORKSPACE_IMAGE_CONTEXT', '/infra/workspace-image'),
  workspaceImageDockerfile: env('WORKSPACE_IMAGE_DOCKERFILE', '/infra/workspace-image/Dockerfile'),
};

if (config.nodeEnv === 'production' && config.runnerSharedSecret === 'dev-runner-shared-secret-change-me') {
  throw new Error('RUNNER_SHARED_SECRET must be set to a strong value in production.');
}
