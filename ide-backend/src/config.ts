import path from 'node:path';

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
  const normalized = raw.trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

export const config = {
  nodeEnv: env('NODE_ENV', 'development'),
  port: envInt('PORT', 8080),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:5173,http://127.0.0.1:5173'),
  jwtSecret: env('JWT_SECRET', 'dev-jwt-secret-change-me'),
  jwtExpiresIn: env('JWT_EXPIRES_IN', '8h'),
  encryptionKey: env('APP_ENCRYPTION_KEY', 'dev-encryption-key-change-me-32bytes'),
  dbPath: env('DB_PATH', path.resolve(process.cwd(), 'data/cloudide.db')),
  workspacesRoot: env('WORKSPACES_ROOT', '/workspaces'),
  runnerUrl: env('RUNNER_URL', 'http://runner:8081'),
  runnerWsUrl: env('RUNNER_WS_URL', 'ws://runner:8081'),
  workspaceImage: env('WORKSPACE_IMAGE', 'cloudide-workspace:latest'),
  workspaceVolume: env('WORKSPACE_VOLUME', 'cloudide-workspaces'),
  defaultCpuLimit: env('DEFAULT_CPU_LIMIT', '1'),
  defaultMemLimit: env('DEFAULT_MEM_LIMIT', '1024m'),
  defaultPidsLimit: envInt('DEFAULT_PIDS_LIMIT', 256),
  defaultAllowEgress: envBool('DEFAULT_ALLOW_EGRESS', true),
  loginRateLimitMax: envInt('LOGIN_RATE_LIMIT_MAX', 10),
  loginRateLimitWindowMs: envInt('LOGIN_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000),
  runnerStartRateLimitMax: envInt('RUNNER_START_RATE_LIMIT_MAX', 30),
  runnerStartRateLimitWindowMs: envInt('RUNNER_START_RATE_LIMIT_WINDOW_MS', 60 * 1000),
};

export const isProd = config.nodeEnv === 'production';
