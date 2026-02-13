import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Boxes,
  Database,
  Download,
  FileClock,
  HardDrive,
  Network,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toast } from 'sonner';

import GlassSurface from '@/components/reactbits/GlassSurface';
import GradualBlur from '@/components/reactbits/GradualBlur';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, toApiMessage } from '@/lib/api';
import { cn, formatBytes, formatDate } from '@/lib/utils';
import type {
  BackupJob,
  BackupJobStatus,
  BackupJobType,
  ContainerMetric,
  MetricSeriesPoint,
  ResourceQuota,
} from '@/types/api';

type MonitoringTab =
  | 'overview'
  | 'containers'
  | 'storage'
  | 'network'
  | 'audit'
  | 'backups'
  | 'quotas';

const TABS: Array<{ id: MonitoringTab; label: string; icon: JSX.Element }> = [
  { id: 'overview', label: 'Overview', icon: <ShieldCheck size={14} /> },
  { id: 'containers', label: 'Containers', icon: <Boxes size={14} /> },
  { id: 'storage', label: 'Storage', icon: <HardDrive size={14} /> },
  { id: 'network', label: 'Network', icon: <Network size={14} /> },
  { id: 'audit', label: 'Audit Logs', icon: <FileClock size={14} /> },
  { id: 'backups', label: 'Backups & Restore', icon: <Database size={14} /> },
  { id: 'quotas', label: 'Quotas', icon: <ShieldCheck size={14} /> },
];

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return 'N/A';
  return `${value.toFixed(1)}%`;
}

function formatUptime(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return 'N/A';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function compactTime(value: string): string {
  const date = new Date(value);
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function toThroughputSeries(points: MetricSeriesPoint[]): Array<{ ts: string; sent_bps: number; recv_bps: number }> {
  const output: Array<{ ts: string; sent_bps: number; recv_bps: number }> = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    if (!prev || !curr) continue;
    const prevTime = new Date(prev.ts).getTime();
    const currTime = new Date(curr.ts).getTime();
    const deltaSeconds = Math.max(1, Math.floor((currTime - prevTime) / 1000));

    const sentDelta = Math.max(0, (curr.net_bytes_sent ?? 0) - (prev.net_bytes_sent ?? 0));
    const recvDelta = Math.max(0, (curr.net_bytes_recv ?? 0) - (prev.net_bytes_recv ?? 0));

    output.push({
      ts: curr.ts,
      sent_bps: sentDelta / deltaSeconds,
      recv_bps: recvDelta / deltaSeconds,
    });
  }
  return output;
}

function statusBadge(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === 'running' || normalized === 'success') {
    return 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100';
  }
  if (normalized === 'failed' || normalized === 'exited' || normalized === 'dead') {
    return 'border-rose-300/35 bg-rose-500/15 text-rose-100';
  }
  if (normalized === 'scheduled') {
    return 'border-amber-300/35 bg-amber-500/15 text-amber-100';
  }
  return 'border-cyan-300/35 bg-cyan-500/15 text-cyan-100';
}

function SectionCard({ title, subtitle, children }: { title: string; subtitle?: string; children: JSX.Element }) {
  return (
    <GlassSurface
      width="100%"
      height="auto"
      borderRadius={20}
      backgroundOpacity={0.08}
      saturation={1.45}
      displace={0.35}
      className="border border-white/15"
    >
      <section className="space-y-3 rounded-[18px] border border-white/10 bg-black/25 p-4">
        <header className="space-y-1">
          <h3 className="text-base font-semibold text-zinc-100">{title}</h3>
          {subtitle ? <p className="text-xs text-zinc-400">{subtitle}</p> : null}
        </header>
        {children}
      </section>
    </GlassSurface>
  );
}

function KpiCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/30 px-4 py-3">
      <p className="text-xs uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
      {detail ? <p className="mt-1 text-xs text-zinc-400">{detail}</p> : null}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="rounded-xl border border-white/10 bg-black/25 p-4 text-sm text-zinc-300">{message}</div>;
}

function MonitoringToolbar({
  autoRefresh,
  setAutoRefresh,
  onRefresh,
}: {
  autoRefresh: boolean;
  setAutoRefresh: (next: boolean) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-zinc-200">
        <input type="checkbox" checked={autoRefresh} onChange={(event) => setAutoRefresh(event.target.checked)} />
        Auto-refresh (5s)
      </label>
      <Button size="sm" variant="secondary" onClick={onRefresh}>
        <RefreshCw size={14} className="mr-1" />
        Refresh now
      </Button>
    </div>
  );
}

export function MonitoringPage() {
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<MonitoringTab>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshInterval = autoRefresh ? 5000 : false;

  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const [selectedBackupId, setSelectedBackupId] = useState<number | null>(null);

  const [backupPage, setBackupPage] = useState(1);
  const [backupStatus, setBackupStatus] = useState<'' | BackupJobStatus>('');
  const [backupType, setBackupType] = useState<'' | BackupJobType>('');
  const [backupSearch, setBackupSearch] = useState('');

  const [restorePage, setRestorePage] = useState(1);
  const [restoreLabel, setRestoreLabel] = useState('');
  const [restoreScope, setRestoreScope] = useState<'system' | 'project' | 'user'>('system');

  const [auditPage, setAuditPage] = useState(1);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditAction, setAuditAction] = useState('');
  const [auditSeverity, setAuditSeverity] = useState('');
  const [auditSuccess, setAuditSuccess] = useState('');

  const [quotaDrafts, setQuotaDrafts] = useState<
    Record<
      number,
      {
        bytes_limit: string;
        max_running_containers: string;
        max_cpu_percent: string;
        max_ram_mb: string;
        monthly_bytes_in_limit: string;
        monthly_bytes_out_limit: string;
      }
    >
  >({});

  const overviewQuery = useQuery({
    queryKey: ['monitoring', 'overview'],
    queryFn: api.monitoring.overview,
    refetchInterval: refreshInterval,
  });

  const containersQuery = useQuery({
    queryKey: ['monitoring', 'containers'],
    queryFn: api.monitoring.containers,
    refetchInterval: refreshInterval,
  });

  const storageQuery = useQuery({
    queryKey: ['monitoring', 'storage'],
    queryFn: api.monitoring.storage,
    refetchInterval: refreshInterval,
  });

  const networkQuery = useQuery({
    queryKey: ['monitoring', 'network'],
    queryFn: api.monitoring.network,
    refetchInterval: refreshInterval,
  });

  const backupsQuery = useQuery({
    queryKey: ['monitoring', 'backups', backupPage, backupStatus, backupType, backupSearch],
    queryFn: () =>
      api.monitoring.backups({
        page: backupPage,
        page_size: 15,
        status: backupStatus || undefined,
        type: backupType || undefined,
        q: backupSearch || undefined,
      }),
    refetchInterval: refreshInterval,
  });

  const backupDetailsQuery = useQuery({
    queryKey: ['monitoring', 'backup', selectedBackupId],
    queryFn: () => api.monitoring.backup(selectedBackupId as number),
    enabled: selectedBackupId !== null,
  });

  const restorePointsQuery = useQuery({
    queryKey: ['monitoring', 'restore-points', restorePage],
    queryFn: () => api.monitoring.restorePoints({ page: restorePage, page_size: 12 }),
    refetchInterval: refreshInterval,
  });

  const quotasQuery = useQuery({
    queryKey: ['monitoring', 'quotas'],
    queryFn: api.monitoring.quotas,
    refetchInterval: refreshInterval,
  });

  const quotaUsageQuery = useQuery({
    queryKey: ['monitoring', 'quota-usage'],
    queryFn: api.monitoring.quotaUsage,
    refetchInterval: refreshInterval,
  });

  const auditActionsQuery = useQuery({
    queryKey: ['audit', 'actions'],
    queryFn: api.audit.actions,
    refetchInterval: refreshInterval,
  });

  const auditLogsQuery = useQuery({
    queryKey: ['audit', 'logs', auditPage, auditSearch, auditAction, auditSeverity, auditSuccess],
    queryFn: () =>
      api.audit.logs({
        page: auditPage,
        page_size: 20,
        q: auditSearch || undefined,
        action: auditAction || undefined,
        severity: auditSeverity || undefined,
        success:
          auditSuccess === ''
            ? undefined
            : auditSuccess === 'true'
              ? true
              : false,
      }),
    refetchInterval: refreshInterval,
  });

  const createRestorePointMutation = useMutation({
    mutationFn: () =>
      api.monitoring.createRestorePoint({
        label: restoreLabel,
        scope: restoreScope,
      }),
    onSuccess: async () => {
      toast.success('Restore point record created');
      setRestoreLabel('');
      await queryClient.invalidateQueries({ queryKey: ['monitoring', 'restore-points'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const updateQuotaMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: number; payload: Record<string, number> }) =>
      api.monitoring.updateQuota(userId, payload),
    onSuccess: async () => {
      toast.success('Quota updated');
      await queryClient.invalidateQueries({ queryKey: ['monitoring', 'quotas'] });
      await queryClient.invalidateQueries({ queryKey: ['monitoring', 'quota-usage'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  useEffect(() => {
    if (!quotasQuery.data) return;
    setQuotaDrafts((prev) => {
      const next = { ...prev };
      for (const quota of quotasQuery.data) {
        if (!next[quota.user_id]) {
          next[quota.user_id] = {
            bytes_limit: String(quota.bytes_limit),
            max_running_containers: String(quota.max_running_containers),
            max_cpu_percent: String(quota.max_cpu_percent),
            max_ram_mb: String(quota.max_ram_mb),
            monthly_bytes_in_limit: String(quota.monthly_bytes_in_limit),
            monthly_bytes_out_limit: String(quota.monthly_bytes_out_limit),
          };
        }
      }
      return next;
    });
  }, [quotasQuery.data]);

  const selectedContainer: ContainerMetric | null = useMemo(() => {
    if (!selectedContainerId || !containersQuery.data) return null;
    return containersQuery.data.items.find((item) => item.id === selectedContainerId) ?? null;
  }, [containersQuery.data, selectedContainerId]);

  const overviewTrend = useMemo(() => {
    return (overviewQuery.data?.snapshots.trend_last_hour ?? []).map((point) => ({
      ts: point.ts,
      cpu: point.cpu_percent ?? 0,
      memory: point.memory_percent ?? 0,
      disk: point.disk_percent ?? 0,
    }));
  }, [overviewQuery.data]);

  const networkThroughputHour = useMemo(
    () => toThroughputSeries(networkQuery.data?.trends.last_hour ?? []),
    [networkQuery.data?.trends.last_hour],
  );

  const degradedMessages = useMemo(() => {
    const messages: string[] = [];
    if (overviewQuery.data?.health.messages) {
      messages.push(...overviewQuery.data.health.messages);
    }
    if (containersQuery.data && !containersQuery.data.available && containersQuery.data.reason) {
      messages.push(containersQuery.data.reason);
    }
    return [...new Set(messages)];
  }, [containersQuery.data, overviewQuery.data?.health.messages]);

  const refreshAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['monitoring'] });
    await queryClient.invalidateQueries({ queryKey: ['audit'] });
  };

  const exportAuditCsv = async () => {
    try {
      const blob = await api.audit.exportCsv({
        q: auditSearch || undefined,
        action: auditAction || undefined,
        severity: auditSeverity || undefined,
        success:
          auditSuccess === ''
            ? undefined
            : auditSuccess === 'true'
              ? true
              : false,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-logs-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(toApiMessage(error));
    }
  };

  const saveQuota = (quota: ResourceQuota) => {
    const draft = quotaDrafts[quota.user_id];
    if (!draft) return;

    const payload = {
      bytes_limit: Number(draft.bytes_limit),
      max_running_containers: Number(draft.max_running_containers),
      max_cpu_percent: Number(draft.max_cpu_percent),
      max_ram_mb: Number(draft.max_ram_mb),
      monthly_bytes_in_limit: Number(draft.monthly_bytes_in_limit),
      monthly_bytes_out_limit: Number(draft.monthly_bytes_out_limit),
    };

    updateQuotaMutation.mutate({ userId: quota.user_id, payload });
  };

  return (
    <div className="relative h-full overflow-auto p-4 sm:p-5">
      <GradualBlur
        target="parent"
        position="bottom"
        height="10rem"
        strength={0.9}
        divCount={4}
        curve="bezier"
        exponential={true}
        opacity={0.5}
      />

      <div className="space-y-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-100">Monitoring</h1>
            <p className="text-sm text-zinc-300">Operational health, system telemetry, audit trails, backup visibility, and quotas.</p>
          </div>
          <MonitoringToolbar autoRefresh={autoRefresh} setAutoRefresh={setAutoRefresh} onRefresh={refreshAll} />
        </div>

        {degradedMessages.length > 0 ? (
          <div className="rounded-xl border border-amber-300/35 bg-amber-500/10 p-3 text-sm text-amber-100">
            <div className="mb-1 flex items-center gap-2 font-medium">
              <AlertTriangle size={14} />
              Degraded Mode
            </div>
            <ul className="space-y-1 text-xs text-amber-100/90">
              {degradedMessages.map((message) => (
                <li key={message}>• {message}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition',
                activeTab === tab.id
                  ? 'border-cyan-300/50 bg-cyan-500/20 text-cyan-100'
                  : 'border-white/10 bg-black/20 text-zinc-300 hover:border-white/25 hover:text-zinc-100',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' ? (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="CPU" value={formatPercent(overviewQuery.data?.kpis.cpu_percent)} detail="Host utilization" />
              <KpiCard label="RAM" value={formatPercent(overviewQuery.data?.kpis.memory_percent)} detail="Physical memory" />
              <KpiCard label="Disk" value={formatPercent(overviewQuery.data?.kpis.disk_percent)} detail="Storage usage" />
              <KpiCard
                label="Network"
                value={`${formatBytes(overviewQuery.data?.kpis.network_total_bytes.recv ?? 0)} in`}
                detail={`${formatBytes(overviewQuery.data?.kpis.network_total_bytes.sent ?? 0)} out`}
              />
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
              <SectionCard title="Host Trend (Last Hour)" subtitle="CPU, RAM, and disk usage from metric snapshots.">
                {overviewTrend.length > 0 ? (
                  <div className="h-[280px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={overviewTrend}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                        <XAxis dataKey="ts" tickFormatter={compactTime} stroke="rgba(255,255,255,0.55)" />
                        <YAxis domain={[0, 100]} stroke="rgba(255,255,255,0.55)" />
                        <Tooltip
                          formatter={(value: number) => `${value.toFixed(1)}%`}
                          labelFormatter={(label) => formatDate(String(label))}
                          contentStyle={{ background: '#0b1328dd', border: '1px solid rgba(255,255,255,0.15)' }}
                        />
                        <Line type="monotone" dataKey="cpu" stroke="#6CF6FF" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="memory" stroke="#7DFFB5" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="disk" stroke="#FF98C7" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <EmptyState message="No snapshot history yet. Snapshot job will populate this panel shortly." />
                )}
              </SectionCard>

              <SectionCard title="Health Summary" subtitle="Current backup and container posture.">
                <div className="space-y-3 text-sm text-zinc-200">
                  <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <p className="text-xs text-zinc-400">Containers</p>
                    <p className="font-medium">
                      {overviewQuery.data?.containers.running ?? 0} running / {overviewQuery.data?.containers.total ?? 0} total
                    </p>
                    {overviewQuery.data?.containers.available ? null : (
                      <p className="mt-1 text-xs text-amber-200">{overviewQuery.data?.containers.reason}</p>
                    )}
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <p className="text-xs text-zinc-400">Backups</p>
                    <p className="font-medium">Running jobs: {overviewQuery.data?.backups.running ?? 0}</p>
                    <p className="mt-1 text-xs text-zinc-400">
                      Last success: {overviewQuery.data?.backups.last_success_at ? formatDate(overviewQuery.data.backups.last_success_at) : 'N/A'}
                    </p>
                    <p className="text-xs text-zinc-400">
                      Last failure: {overviewQuery.data?.backups.last_failure_at ? formatDate(overviewQuery.data.backups.last_failure_at) : 'N/A'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <p className="text-xs text-zinc-400">Snapshots</p>
                    <p className="font-medium">Every {overviewQuery.data?.snapshots.interval_seconds ?? 30}s</p>
                    <p className="text-xs text-zinc-400">Retention: {overviewQuery.data?.snapshots.retention_days ?? 7} days</p>
                  </div>
                </div>
              </SectionCard>
            </div>
          </div>
        ) : null}

        {activeTab === 'containers' ? (
          <SectionCard title="Container Status" subtitle="Docker runtime inventory with resource usage when available.">
            <div className="space-y-3">
              {!containersQuery.data?.available ? (
                <div className="rounded-lg border border-amber-300/35 bg-amber-500/10 p-3 text-xs text-amber-100">
                  Container metrics unavailable: {containersQuery.data?.reason || 'No provider response'}
                </div>
              ) : null}

              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-300">
                    <tr>
                      <th className="px-3 py-2">Container</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">CPU</th>
                      <th className="px-3 py-2">Memory</th>
                      <th className="px-3 py-2">Uptime</th>
                      <th className="px-3 py-2">Restart</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(containersQuery.data?.items ?? []).map((item) => (
                      <tr
                        key={item.id}
                        onClick={() => setSelectedContainerId(item.id)}
                        className="cursor-pointer border-t border-white/10 bg-black/20 hover:bg-cyan-500/10"
                      >
                        <td className="px-3 py-2">
                          <p className="font-medium text-zinc-100">{item.name}</p>
                          <p className="text-xs text-zinc-400">{item.image}</p>
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn('rounded-full border px-2 py-0.5 text-xs', statusBadge(item.status))}>{item.status}</span>
                        </td>
                        <td className="px-3 py-2 text-zinc-200">{formatPercent(item.cpu_percent)}</td>
                        <td className="px-3 py-2 text-zinc-200">
                          {item.memory_usage_bytes !== null ? formatBytes(item.memory_usage_bytes) : 'N/A'}
                        </td>
                        <td className="px-3 py-2 text-zinc-200">{formatUptime(item.uptime_seconds)}</td>
                        <td className="px-3 py-2 text-zinc-200">{item.restart_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </SectionCard>
        ) : null}

        {activeTab === 'storage' ? (
          <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <SectionCard title="Storage Capacity" subtitle="Host storage and highest consumers.">
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <p className="text-zinc-400">Total</p>
                    <p className="font-semibold text-zinc-100">{formatBytes(storageQuery.data?.total_bytes ?? 0)}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <p className="text-zinc-400">Used</p>
                    <p className="font-semibold text-zinc-100">{formatBytes(storageQuery.data?.used_bytes ?? 0)}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                    <p className="text-zinc-400">Free</p>
                    <p className="font-semibold text-zinc-100">{formatBytes(storageQuery.data?.free_bytes ?? 0)}</p>
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Top Directories</p>
                  <div className="space-y-1.5 text-sm">
                    {(storageQuery.data?.top_directories ?? []).slice(0, 8).map((entry) => (
                      <div key={entry.path} className="flex items-center justify-between rounded-lg bg-black/25 px-2 py-1">
                        <span className="truncate pr-2 text-zinc-300">{entry.path}</span>
                        <span className="text-zinc-100">{formatBytes(entry.size_bytes)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="User / Project Usage" subtitle="Per-user and per-project storage distribution.">
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">By User</p>
                  <div className="max-h-[200px] space-y-1 overflow-y-auto pr-1">
                    {(storageQuery.data?.per_user ?? []).map((row) => (
                      <div key={row.user_id} className="grid grid-cols-[1fr_auto_auto] gap-2 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-sm">
                        <span className="truncate text-zinc-200">{row.username}</span>
                        <span className="text-zinc-100">{formatBytes(row.bytes_used)}</span>
                        <span className="text-xs text-zinc-400">{row.usage_percent ? `${row.usage_percent.toFixed(1)}%` : 'N/A'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-zinc-400">By Project</p>
                  <div className="max-h-[200px] space-y-1 overflow-y-auto pr-1">
                    {(storageQuery.data?.per_project ?? []).map((row) => (
                      <div key={row.project} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-sm">
                        <span className="truncate pr-2 text-zinc-200">{row.project}</span>
                        <span className="text-zinc-100">{formatBytes(row.size_bytes)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'network' ? (
          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
            <SectionCard title="Network Throughput" subtitle="Calculated from snapshot deltas (bytes/sec).">
              {networkThroughputHour.length > 0 ? (
                <div className="h-[290px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={networkThroughputHour}>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" />
                      <XAxis dataKey="ts" tickFormatter={compactTime} stroke="rgba(255,255,255,0.55)" />
                      <YAxis tickFormatter={(value) => formatBytes(value)} stroke="rgba(255,255,255,0.55)" />
                      <Tooltip
                        formatter={(value: number) => `${formatBytes(value)}/s`}
                        labelFormatter={(label) => formatDate(String(label))}
                        contentStyle={{ background: '#0b1328dd', border: '1px solid rgba(255,255,255,0.15)' }}
                      />
                      <Area type="monotone" dataKey="recv_bps" stroke="#7DFFB5" fill="rgba(125,255,181,0.25)" strokeWidth={2} />
                      <Area type="monotone" dataKey="sent_bps" stroke="#6CF6FF" fill="rgba(108,246,255,0.24)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState message="No network trend points available yet." />
              )}
            </SectionCard>

            <SectionCard title="Interface Totals" subtitle="Per-interface cumulative byte counters.">
              <div className="space-y-2">
                {(networkQuery.data?.interfaces ?? []).slice(0, 10).map((iface) => (
                  <div key={iface.name} className="rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-xs">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="font-medium text-zinc-100">{iface.name}</span>
                      <span className="text-zinc-300">RX {formatBytes(iface.bytes_recv)}</span>
                    </div>
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>TX {formatBytes(iface.bytes_sent)}</span>
                      <span>
                        err {iface.errin + iface.errout} / drop {iface.dropin + iface.dropout}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'audit' ? (
          <SectionCard title="Audit Logs" subtitle="Server-side filtering and CSV export.">
            <div className="space-y-3">
              <div className="grid gap-2 lg:grid-cols-[2fr_1fr_1fr_1fr_auto]">
                <div className="relative">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-zinc-500" />
                  <Input
                    className="pl-8"
                    placeholder="Search action/entity/metadata"
                    value={auditSearch}
                    onChange={(event) => {
                      setAuditPage(1);
                      setAuditSearch(event.target.value);
                    }}
                  />
                </div>
                <select
                  className="rounded-md border border-white/15 bg-black/35 px-2 text-sm"
                  value={auditAction}
                  onChange={(event) => {
                    setAuditPage(1);
                    setAuditAction(event.target.value);
                  }}
                >
                  <option value="">All actions</option>
                  {(auditActionsQuery.data ?? []).map((action) => (
                    <option key={action} value={action}>
                      {action}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-md border border-white/15 bg-black/35 px-2 text-sm"
                  value={auditSeverity}
                  onChange={(event) => {
                    setAuditPage(1);
                    setAuditSeverity(event.target.value);
                  }}
                >
                  <option value="">All severity</option>
                  <option value="info">info</option>
                  <option value="warning">warning</option>
                  <option value="error">error</option>
                </select>
                <select
                  className="rounded-md border border-white/15 bg-black/35 px-2 text-sm"
                  value={auditSuccess}
                  onChange={(event) => {
                    setAuditPage(1);
                    setAuditSuccess(event.target.value);
                  }}
                >
                  <option value="">All outcomes</option>
                  <option value="true">success</option>
                  <option value="false">failed</option>
                </select>
                <Button size="sm" variant="secondary" onClick={exportAuditCsv}>
                  <Download size={14} className="mr-1" />
                  Export CSV
                </Button>
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-300">
                    <tr>
                      <th className="px-3 py-2">Time</th>
                      <th className="px-3 py-2">Actor</th>
                      <th className="px-3 py-2">Action</th>
                      <th className="px-3 py-2">Entity</th>
                      <th className="px-3 py-2">Severity</th>
                      <th className="px-3 py-2">Success</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(auditLogsQuery.data?.items ?? []).map((log) => (
                      <tr key={log.id} className="border-t border-white/10 bg-black/20">
                        <td className="px-3 py-2 text-xs text-zinc-300">{formatDate(log.ts)}</td>
                        <td className="px-3 py-2 text-zinc-200">{log.actor_username || log.actor_user_id || 'system'}</td>
                        <td className="px-3 py-2 text-zinc-100">{log.action}</td>
                        <td className="px-3 py-2 text-zinc-300">
                          {log.entity_type || 'n/a'}
                          {log.entity_id ? `#${log.entity_id}` : ''}
                        </td>
                        <td className="px-3 py-2">
                          <span className={cn('rounded-full border px-2 py-0.5 text-xs', statusBadge(log.severity))}>{log.severity}</span>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <span
                            className={cn(
                              'rounded-full border px-2 py-0.5',
                              log.success
                                ? 'border-emerald-300/35 bg-emerald-500/15 text-emerald-100'
                                : 'border-rose-300/35 bg-rose-500/15 text-rose-100',
                            )}
                          >
                            {log.success ? 'yes' : 'no'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>
                  Page {auditLogsQuery.data?.pagination.page ?? 1} / {auditLogsQuery.data?.pagination.total_pages ?? 1} •{' '}
                  {auditLogsQuery.data?.pagination.total ?? 0} entries
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAuditPage((prev) => Math.max(1, prev - 1))}>
                    Prev
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setAuditPage((prev) => prev + 1)}
                    disabled={
                      (auditLogsQuery.data?.pagination.page ?? 1) >= (auditLogsQuery.data?.pagination.total_pages ?? 1)
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          </SectionCard>
        ) : null}

        {activeTab === 'backups' ? (
          <div className="space-y-4">
            <SectionCard title="Backup Jobs" subtitle="Filter backup runs and inspect logs.">
              <div className="space-y-3">
                <div className="grid gap-2 lg:grid-cols-[2fr_1fr_1fr]">
                  <Input
                    placeholder="Search target or error"
                    value={backupSearch}
                    onChange={(event) => {
                      setBackupPage(1);
                      setBackupSearch(event.target.value);
                    }}
                  />
                  <select
                    className="rounded-md border border-white/15 bg-black/35 px-2 text-sm"
                    value={backupStatus}
                    onChange={(event) => {
                      setBackupPage(1);
                      setBackupStatus((event.target.value as BackupJobStatus | '') || '');
                    }}
                  >
                    <option value="">All status</option>
                    <option value="scheduled">scheduled</option>
                    <option value="running">running</option>
                    <option value="success">success</option>
                    <option value="failed">failed</option>
                  </select>
                  <select
                    className="rounded-md border border-white/15 bg-black/35 px-2 text-sm"
                    value={backupType}
                    onChange={(event) => {
                      setBackupPage(1);
                      setBackupType((event.target.value as BackupJobType | '') || '');
                    }}
                  >
                    <option value="">All types</option>
                    <option value="full">full</option>
                    <option value="incremental">incremental</option>
                  </select>
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-300">
                      <tr>
                        <th className="px-3 py-2">ID</th>
                        <th className="px-3 py-2">Type</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Target</th>
                        <th className="px-3 py-2">Started</th>
                        <th className="px-3 py-2">Size</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(backupsQuery.data?.items ?? []).map((job) => (
                        <tr
                          key={job.id}
                          className="cursor-pointer border-t border-white/10 bg-black/20 hover:bg-cyan-500/10"
                          onClick={() => setSelectedBackupId(job.id)}
                        >
                          <td className="px-3 py-2 text-zinc-300">#{job.id}</td>
                          <td className="px-3 py-2 text-zinc-100">{job.type}</td>
                          <td className="px-3 py-2">
                            <span className={cn('rounded-full border px-2 py-0.5 text-xs', statusBadge(job.status))}>{job.status}</span>
                          </td>
                          <td className="max-w-[260px] truncate px-3 py-2 text-zinc-300">{job.target}</td>
                          <td className="px-3 py-2 text-zinc-300">{job.started_at ? formatDate(job.started_at) : 'N/A'}</td>
                          <td className="px-3 py-2 text-zinc-300">{job.size_bytes ? formatBytes(job.size_bytes) : 'N/A'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>
                    Page {backupsQuery.data?.pagination.page ?? 1} / {backupsQuery.data?.pagination.total_pages ?? 1}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setBackupPage((prev) => Math.max(1, prev - 1))}>
                      Prev
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setBackupPage((prev) => prev + 1)}
                      disabled={(backupsQuery.data?.pagination.page ?? 1) >= (backupsQuery.data?.pagination.total_pages ?? 1)}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Restore Points" subtitle="Metadata records for restorable states.">
              <div className="space-y-3">
                <div className="grid gap-2 lg:grid-cols-[2fr_1fr_auto]">
                  <Input
                    placeholder="Restore point label"
                    value={restoreLabel}
                    onChange={(event) => setRestoreLabel(event.target.value)}
                  />
                  <select
                    className="rounded-md border border-white/15 bg-black/35 px-2 text-sm"
                    value={restoreScope}
                    onChange={(event) => setRestoreScope(event.target.value as 'system' | 'project' | 'user')}
                  >
                    <option value="system">system</option>
                    <option value="project">project</option>
                    <option value="user">user</option>
                  </select>
                  <Button
                    size="sm"
                    onClick={() => createRestorePointMutation.mutate()}
                    disabled={createRestorePointMutation.isPending || restoreLabel.trim().length < 2}
                  >
                    Create
                  </Button>
                </div>

                <div className="overflow-x-auto rounded-xl border border-white/10">
                  <table className="min-w-full text-left text-sm">
                    <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-300">
                      <tr>
                        <th className="px-3 py-2">ID</th>
                        <th className="px-3 py-2">Label</th>
                        <th className="px-3 py-2">Scope</th>
                        <th className="px-3 py-2">Created</th>
                        <th className="px-3 py-2">Size</th>
                        <th className="px-3 py-2">Metadata</th>
                        <th className="px-3 py-2">Restore</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(restorePointsQuery.data?.items ?? []).map((point) => (
                        <tr key={point.id} className="border-t border-white/10 bg-black/20">
                          <td className="px-3 py-2 text-zinc-300">#{point.id}</td>
                          <td className="px-3 py-2 text-zinc-100">{point.label}</td>
                          <td className="px-3 py-2 text-zinc-300">{point.scope}</td>
                          <td className="px-3 py-2 text-zinc-300">{formatDate(point.created_at)}</td>
                          <td className="px-3 py-2 text-zinc-300">{point.size_bytes ? formatBytes(point.size_bytes) : 'N/A'}</td>
                          <td className="max-w-[260px] truncate px-3 py-2 text-zinc-300">
                            {Object.keys(point.metadata ?? {}).length > 0 ? JSON.stringify(point.metadata) : '{}'}
                          </td>
                          <td className="px-3 py-2">
                            <Button size="sm" variant="secondary" disabled title="Restore execution is stubbed in MVP">
                              Restore
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>
                    Page {restorePointsQuery.data?.pagination.page ?? 1} / {restorePointsQuery.data?.pagination.total_pages ?? 1}
                  </span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setRestorePage((prev) => Math.max(1, prev - 1))}>
                      Prev
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setRestorePage((prev) => prev + 1)}
                      disabled={
                        (restorePointsQuery.data?.pagination.page ?? 1) >=
                        (restorePointsQuery.data?.pagination.total_pages ?? 1)
                      }
                    >
                      Next
                    </Button>
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>
        ) : null}

        {activeTab === 'quotas' ? (
          <SectionCard title="Resource Quotas" subtitle="Storage, runtime limits, and monthly bandwidth quotas.">
            <div className="space-y-3">
              <div className="overflow-x-auto rounded-xl border border-white/10">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-black/40 text-xs uppercase tracking-wide text-zinc-300">
                    <tr>
                      <th className="px-3 py-2">User</th>
                      <th className="px-3 py-2">Storage</th>
                      <th className="px-3 py-2">Containers</th>
                      <th className="px-3 py-2">CPU / RAM</th>
                      <th className="px-3 py-2">Bandwidth In/Out</th>
                      <th className="px-3 py-2">Save</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(quotasQuery.data ?? []).map((quota) => {
                      const draft = quotaDrafts[quota.user_id];
                      const usage = quotaUsageQuery.data?.items.find((item) => item.user_id === quota.user_id);

                      return (
                        <tr key={quota.user_id} className="border-t border-white/10 bg-black/20 align-top">
                          <td className="px-3 py-2">
                            <p className="font-medium text-zinc-100">{quota.username ?? `user#${quota.user_id}`}</p>
                            <p className="text-xs text-zinc-400">Updated {formatDate(quota.updated_at)}</p>
                          </td>
                          <td className="space-y-1 px-3 py-2">
                            <Input
                              value={draft?.bytes_limit ?? String(quota.bytes_limit)}
                              onChange={(event) =>
                                setQuotaDrafts((prev) => ({
                                  ...prev,
                                  [quota.user_id]: {
                                    ...(prev[quota.user_id] ?? {
                                      bytes_limit: String(quota.bytes_limit),
                                      max_running_containers: String(quota.max_running_containers),
                                      max_cpu_percent: String(quota.max_cpu_percent),
                                      max_ram_mb: String(quota.max_ram_mb),
                                      monthly_bytes_in_limit: String(quota.monthly_bytes_in_limit),
                                      monthly_bytes_out_limit: String(quota.monthly_bytes_out_limit),
                                    }),
                                    bytes_limit: event.target.value,
                                  },
                                }))
                              }
                            />
                            <p className="text-xs text-zinc-400">
                              Used: {usage ? formatBytes(usage.storage.bytes_used) : formatBytes(quota.bytes_used)}
                            </p>
                          </td>
                          <td className="space-y-1 px-3 py-2">
                            <Input
                              value={draft?.max_running_containers ?? String(quota.max_running_containers)}
                              onChange={(event) =>
                                setQuotaDrafts((prev) => ({
                                  ...prev,
                                  [quota.user_id]: {
                                    ...(prev[quota.user_id] ?? {
                                      bytes_limit: String(quota.bytes_limit),
                                      max_running_containers: String(quota.max_running_containers),
                                      max_cpu_percent: String(quota.max_cpu_percent),
                                      max_ram_mb: String(quota.max_ram_mb),
                                      monthly_bytes_in_limit: String(quota.monthly_bytes_in_limit),
                                      monthly_bytes_out_limit: String(quota.monthly_bytes_out_limit),
                                    }),
                                    max_running_containers: event.target.value,
                                  },
                                }))
                              }
                            />
                            <p className="text-xs text-zinc-400">
                              Running now: {usage?.containers.running ?? (quotaUsageQuery.data?.container_metrics_available ? 0 : 'N/A')}
                            </p>
                          </td>
                          <td className="space-y-1 px-3 py-2">
                            <Input
                              placeholder="Max CPU %"
                              value={draft?.max_cpu_percent ?? String(quota.max_cpu_percent)}
                              onChange={(event) =>
                                setQuotaDrafts((prev) => ({
                                  ...prev,
                                  [quota.user_id]: {
                                    ...(prev[quota.user_id] ?? {
                                      bytes_limit: String(quota.bytes_limit),
                                      max_running_containers: String(quota.max_running_containers),
                                      max_cpu_percent: String(quota.max_cpu_percent),
                                      max_ram_mb: String(quota.max_ram_mb),
                                      monthly_bytes_in_limit: String(quota.monthly_bytes_in_limit),
                                      monthly_bytes_out_limit: String(quota.monthly_bytes_out_limit),
                                    }),
                                    max_cpu_percent: event.target.value,
                                  },
                                }))
                              }
                            />
                            <Input
                              placeholder="Max RAM MB"
                              value={draft?.max_ram_mb ?? String(quota.max_ram_mb)}
                              onChange={(event) =>
                                setQuotaDrafts((prev) => ({
                                  ...prev,
                                  [quota.user_id]: {
                                    ...(prev[quota.user_id] ?? {
                                      bytes_limit: String(quota.bytes_limit),
                                      max_running_containers: String(quota.max_running_containers),
                                      max_cpu_percent: String(quota.max_cpu_percent),
                                      max_ram_mb: String(quota.max_ram_mb),
                                      monthly_bytes_in_limit: String(quota.monthly_bytes_in_limit),
                                      monthly_bytes_out_limit: String(quota.monthly_bytes_out_limit),
                                    }),
                                    max_ram_mb: event.target.value,
                                  },
                                }))
                              }
                            />
                          </td>
                          <td className="space-y-1 px-3 py-2">
                            <Input
                              placeholder="Monthly in limit"
                              value={draft?.monthly_bytes_in_limit ?? String(quota.monthly_bytes_in_limit)}
                              onChange={(event) =>
                                setQuotaDrafts((prev) => ({
                                  ...prev,
                                  [quota.user_id]: {
                                    ...(prev[quota.user_id] ?? {
                                      bytes_limit: String(quota.bytes_limit),
                                      max_running_containers: String(quota.max_running_containers),
                                      max_cpu_percent: String(quota.max_cpu_percent),
                                      max_ram_mb: String(quota.max_ram_mb),
                                      monthly_bytes_in_limit: String(quota.monthly_bytes_in_limit),
                                      monthly_bytes_out_limit: String(quota.monthly_bytes_out_limit),
                                    }),
                                    monthly_bytes_in_limit: event.target.value,
                                  },
                                }))
                              }
                            />
                            <Input
                              placeholder="Monthly out limit"
                              value={draft?.monthly_bytes_out_limit ?? String(quota.monthly_bytes_out_limit)}
                              onChange={(event) =>
                                setQuotaDrafts((prev) => ({
                                  ...prev,
                                  [quota.user_id]: {
                                    ...(prev[quota.user_id] ?? {
                                      bytes_limit: String(quota.bytes_limit),
                                      max_running_containers: String(quota.max_running_containers),
                                      max_cpu_percent: String(quota.max_cpu_percent),
                                      max_ram_mb: String(quota.max_ram_mb),
                                      monthly_bytes_in_limit: String(quota.monthly_bytes_in_limit),
                                      monthly_bytes_out_limit: String(quota.monthly_bytes_out_limit),
                                    }),
                                    monthly_bytes_out_limit: event.target.value,
                                  },
                                }))
                              }
                            />
                            <p className="text-xs text-zinc-400">
                              Used: {usage ? `${formatBytes(usage.bandwidth.bytes_in_used)} in / ${formatBytes(usage.bandwidth.bytes_out_used)} out` : 'N/A'}
                            </p>
                          </td>
                          <td className="px-3 py-2">
                            <Button size="sm" onClick={() => saveQuota(quota)} disabled={updateQuotaMutation.isPending}>
                              <Save size={14} className="mr-1" />
                              Save
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </SectionCard>
        ) : null}
      </div>

      {selectedContainer ? (
        <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm" onClick={() => setSelectedContainerId(null)}>
          <div
            className="absolute right-0 top-0 h-full w-full max-w-md border-l border-white/15 bg-[#060b1fcc] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-100">{selectedContainer.name}</h3>
              <Button size="sm" variant="secondary" onClick={() => setSelectedContainerId(null)}>
                Close
              </Button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <p className="text-xs text-zinc-400">Image</p>
                <p className="text-zinc-100">{selectedContainer.image}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <p className="text-xs text-zinc-400">Status</p>
                <p className="text-zinc-100">{selectedContainer.status}</p>
                <p className="mt-1 text-xs text-zinc-400">Uptime: {formatUptime(selectedContainer.uptime_seconds)}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <p className="text-xs text-zinc-400">Ports</p>
                <div className="mt-1 space-y-1 text-zinc-200">
                  {selectedContainer.ports.length === 0 ? (
                    <p className="text-xs text-zinc-400">No published ports</p>
                  ) : (
                    selectedContainer.ports.map((port) => (
                      <p key={`${port.container_port}-${port.host_ip}-${port.host_port}`}>
                        {port.host_ip}:{port.host_port} → {port.container_port}
                      </p>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 p-3">
                <p className="text-xs text-zinc-400">Environment Summary</p>
                <p className="mt-1 text-zinc-200">{selectedContainer.env_summary.count} keys detected (values redacted)</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedContainer.env_summary.keys.slice(0, 20).map((key) => (
                    <span key={key} className="rounded-full border border-white/15 bg-black/35 px-2 py-0.5 text-[11px] text-zinc-300">
                      {key}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectedBackupId !== null ? (
        <div className="fixed inset-0 z-40 bg-black/45 backdrop-blur-sm" onClick={() => setSelectedBackupId(null)}>
          <div
            className="absolute left-1/2 top-1/2 w-[min(92vw,860px)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-white/15 bg-[#060b1fcc] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-zinc-100">Backup Job #{selectedBackupId}</h3>
              <Button size="sm" variant="secondary" onClick={() => setSelectedBackupId(null)}>
                Close
              </Button>
            </div>

            <div className="space-y-2 text-sm">
              <p className="text-zinc-300">Status: {backupDetailsQuery.data?.status ?? 'loading...'}</p>
              <p className="text-zinc-300">Target: {backupDetailsQuery.data?.target ?? '-'}</p>
              <div className="max-h-[320px] overflow-auto rounded-lg border border-white/10 bg-black/30 p-3">
                <pre className="whitespace-pre-wrap text-xs text-zinc-200">{backupDetailsQuery.data?.logs || 'No logs.'}</pre>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
