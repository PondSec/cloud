import { describe, expect, it } from 'vitest';

import { buildDockerRunArgs } from '../src/services/docker.js';

describe('workspace container start args', () => {
  it('includes security and resource limits', () => {
    const args = buildDockerRunArgs({
      workspaceId: 'ws-123',
      image: 'cloudide-workspace:latest',
      volumeName: 'cloudide-workspaces',
      cpuLimit: '1.5',
      memLimit: '1536m',
      pidsLimit: 300,
      allowEgress: false,
    });

    expect(args).toContain('--cap-drop');
    expect(args).toContain('ALL');
    expect(args).toContain('--security-opt');
    expect(args).toContain('no-new-privileges');
    expect(args).toContain('seccomp=default');
    expect(args).toContain('--read-only');
    expect(args).toContain('--cpus');
    expect(args).toContain('1.5');
    expect(args).toContain('--memory');
    expect(args).toContain('1536m');
    expect(args).toContain('--pids-limit');
    expect(args).toContain('300');
    expect(args).toContain('--network');
    expect(args).toContain('none');
  });
});
