import { ArrowDown, ArrowUp, Loader2, Mail, Paintbrush, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUiPrefs, type EffectsQuality } from '@/contexts/UiPrefsContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { api, toApiMessage } from '@/lib/api';
import { APP_SHORTCUTS, BRAND, comboForPlatform } from '@/lib/brand';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { formatBytes } from '@/lib/utils';

const DOCK_ENTRIES: Array<{ path: string; label: string }> = [
  { path: '/app/home', label: 'Start' },
  { path: '/app/files', label: 'Dateien' },
  { path: '/app/search', label: 'Suche' },
  { path: '/app/recents', label: 'Zuletzt' },
  { path: '/app/shared', label: 'Freigaben' },
  { path: '/app/media', label: 'Medien' },
  { path: '/app/email', label: 'Email' },
  { path: '/dev/workspaces', label: 'Studio' },
  { path: '/app/admin', label: 'Verwaltung' },
  { path: '/app/monitoring', label: 'System' },
  { path: '/app/settings', label: 'Einstellungen' },
  { path: '/app/inventorypro', label: 'Inventory Pro' },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const { prefs, isLoaded, isSyncing, setEffectsQuality, setAnimationsEnabled, updatePrefs, setDockOrder, resetPrefs } = useUiPrefs();
  const isMac = useMemo(
    () => (typeof navigator !== 'undefined' ? /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) : false),
    [],
  );
  const canUseStudio = hasPermission(user, PERMISSIONS.IDE_USE);

  const mailAccountsQuery = useQuery({
    queryKey: ['mail', 'accounts'],
    queryFn: api.mail.accounts,
  });
  const mailAccounts = mailAccountsQuery.data ?? [];

  type MailProviderPreset = 'gmail' | 'office365' | 'icloud' | 'custom';
  type MailSecurity = 'ssl' | 'starttls' | 'none';
  interface MailFormState {
    preset: MailProviderPreset;
    label: string;
    email_address: string;
    imap_host: string;
    imap_port: number;
    imap_security: MailSecurity;
    imap_username: string;
    imap_password: string;
    smtp_host: string;
    smtp_port: number;
    smtp_security: MailSecurity;
    smtp_username: string;
    smtp_password: string;
  }

  const [mailForm, setMailForm] = useState<MailFormState>({
    preset: 'gmail',
    label: '',
    email_address: '',
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    imap_security: 'ssl',
    imap_username: '',
    imap_password: '',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 465,
    smtp_security: 'ssl',
    smtp_username: '',
    smtp_password: '',
  });

  const updateMailForm = (patch: Partial<MailFormState>) => setMailForm((prev) => ({ ...prev, ...patch }));

  const createMailAccount = useMutation({
    mutationFn: async () => {
      return api.mail.createAccount({
        label: mailForm.label || undefined,
        email_address: mailForm.email_address,
        imap_host: mailForm.imap_host,
        imap_port: mailForm.imap_port,
        imap_security: mailForm.imap_security,
        imap_username: mailForm.imap_username || mailForm.email_address,
        imap_password: mailForm.imap_password,
        smtp_host: mailForm.smtp_host,
        smtp_port: mailForm.smtp_port,
        smtp_security: mailForm.smtp_security,
        smtp_username: mailForm.smtp_username || mailForm.imap_username || mailForm.email_address,
        smtp_password: mailForm.smtp_password || mailForm.imap_password,
      });
    },
    onSuccess: (account) => {
      toast.success('Email-Konto hinzugefuegt.');
      updateMailForm({ label: '', imap_password: '', smtp_password: '' });
      void queryClient.invalidateQueries({ queryKey: ['mail', 'accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['mail', 'context'] });
      navigate(`/app/email?accountId=${account.id}`);
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const deleteMailAccount = useMutation({
    mutationFn: async (accountId: number) => {
      await api.mail.deleteAccount(accountId);
    },
    onSuccess: () => {
      toast.success('Email-Konto entfernt.');
      void queryClient.invalidateQueries({ queryKey: ['mail', 'accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['mail', 'context'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const testMailAccount = useMutation({
    mutationFn: async (accountId: number) => api.mail.testAccount(accountId),
    onSuccess: (result) => {
      if (result.ok) {
        const uidCountLabel = typeof result.inbox_uid_count === 'number' ? String(result.inbox_uid_count) : '?';
        const serverCountLabel = typeof result.inbox_messages === 'number' ? String(result.inbox_messages) : '?';
        toast.success(`Verbindung OK. INBOX: ${uidCountLabel} Nachrichten (Server: ${serverCountLabel}).`);
      }
      else toast.error(`Test fehlgeschlagen: IMAP ${result.imap_ok ? 'OK' : 'FAIL'} · SMTP ${result.smtp_ok ? 'OK' : 'FAIL'}`);
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const qualityOptions: EffectsQuality[] = ['low', 'medium', 'high'];
  const dockOrder = useMemo(() => {
    const fallback = DOCK_ENTRIES.map((entry) => entry.path);
    const list = Array.isArray(prefs.dockOrder) ? prefs.dockOrder : fallback;
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const path of [...list, ...fallback]) {
      if (seen.has(path)) continue;
      seen.add(path);
      normalized.push(path);
    }
    return normalized;
  }, [prefs.dockOrder]);

  const moveDockEntry = (path: string, direction: -1 | 1) => {
    const index = dockOrder.indexOf(path);
    if (index < 0) return;
    const target = index + direction;
    if (target < 0 || target >= dockOrder.length) return;
    const next = [...dockOrder];
    const [entry] = next.splice(index, 1);
    if (!entry) return;
    next.splice(target, 0, entry);
    setDockOrder(next);
  };

  return (
    <div className="h-full space-y-6 overflow-auto p-4">
      <div>
        <h1 className="text-2xl font-semibold">Einstellungen</h1>
        <p className="text-sm text-zinc-300">
          {BRAND.fullName} passt sich an Sie an. Alle Anpassungen werden pro Benutzerkonto gespeichert.
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
          {!isLoaded ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Profil-Design wird geladen
            </>
          ) : isSyncing ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Einstellungen werden gespeichert
            </>
          ) : (
            <span>Einstellungen sind synchronisiert</span>
          )}
          <Button size="sm" variant="secondary" onClick={resetPrefs}>
            <RotateCcw size={12} className="mr-1" />
            Zurücksetzen
          </Button>
        </div>
      </div>

      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <h2 className="mb-3 text-lg font-semibold">Konto</h2>
        <div className="grid gap-2 text-sm text-zinc-200">
          <p>
            Nutzername: <span className="text-cyan-200">{user?.username}</span>
          </p>
          <p>
            Speicherstand: {formatBytes(user?.bytes_used ?? 0)} / {formatBytes(user?.bytes_limit ?? 0)}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="mb-4 flex items-center gap-2">
          <Mail size={16} className="text-cyan-300" />
          <h2 className="text-lg font-semibold">Email</h2>
        </div>

        <p className="mb-4 text-sm text-zinc-300">
          Fuegen Sie ein IMAP/SMTP Konto hinzu. Hinweis: Gmail und iCloud benoetigen in der Regel ein App-Passwort (kein normales Login-Passwort).
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm text-zinc-200">
            <span>Provider Preset</span>
            <select
              className="w-full rounded-md border border-white/15 bg-black/35 px-2 py-1.5 text-sm"
              value={mailForm.preset}
              onChange={(event) => {
                const preset = event.target.value as 'gmail' | 'office365' | 'icloud' | 'custom';
                if (preset === 'gmail') {
                  updateMailForm({
                    preset,
                    imap_host: 'imap.gmail.com',
                    imap_port: 993,
                    imap_security: 'ssl',
                    smtp_host: 'smtp.gmail.com',
                    smtp_port: 465,
                    smtp_security: 'ssl',
                  });
                  return;
                }
                if (preset === 'office365') {
                  updateMailForm({
                    preset,
                    imap_host: 'outlook.office365.com',
                    imap_port: 993,
                    imap_security: 'ssl',
                    smtp_host: 'smtp.office365.com',
                    smtp_port: 587,
                    smtp_security: 'starttls',
                  });
                  return;
                }
                if (preset === 'icloud') {
                  updateMailForm({
                    preset,
                    imap_host: 'imap.mail.me.com',
                    imap_port: 993,
                    imap_security: 'ssl',
                    smtp_host: 'smtp.mail.me.com',
                    smtp_port: 587,
                    smtp_security: 'starttls',
                  });
                  return;
                }
                updateMailForm({ preset });
              }}
            >
              <option value="gmail">Gmail (IMAP)</option>
              <option value="office365">Outlook / Office365</option>
              <option value="icloud">iCloud Mail</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <span>Anzeigename (optional)</span>
            <Input value={mailForm.label} onChange={(event) => updateMailForm({ label: event.target.value })} placeholder="z.B. Arbeit" />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <span>Email Adresse</span>
            <Input
              type="email"
              value={mailForm.email_address}
              onChange={(event) => {
                const email = event.target.value;
                updateMailForm({
                  email_address: email,
                  imap_username: mailForm.imap_username ? mailForm.imap_username : email,
                  smtp_username: mailForm.smtp_username ? mailForm.smtp_username : email,
                });
              }}
              placeholder="name@domain.tld"
            />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <span>IMAP Username</span>
            <Input value={mailForm.imap_username} onChange={(event) => updateMailForm({ imap_username: event.target.value })} placeholder="meist die Email Adresse" />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <span>IMAP Passwort</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={mailForm.imap_password}
              onChange={(event) => updateMailForm({ imap_password: event.target.value })}
              placeholder="App Passwort / Login Passwort"
            />
          </label>

          <div className="grid gap-2 md:grid-cols-3">
            <label className="space-y-1 text-sm text-zinc-200 md:col-span-2">
              <span>IMAP Host</span>
              <Input value={mailForm.imap_host} onChange={(event) => updateMailForm({ imap_host: event.target.value })} placeholder="imap.example.com" />
            </label>
            <label className="space-y-1 text-sm text-zinc-200">
              <span>IMAP Port</span>
              <Input
                type="number"
                value={mailForm.imap_port}
                onChange={(event) => updateMailForm({ imap_port: Number(event.target.value) })}
                placeholder="993"
              />
            </label>
          </div>

          <label className="space-y-1 text-sm text-zinc-200">
            <span>IMAP Security</span>
            <select
              className="w-full rounded-md border border-white/15 bg-black/35 px-2 py-1.5 text-sm"
              value={mailForm.imap_security}
              onChange={(event) => updateMailForm({ imap_security: event.target.value as any })}
            >
              <option value="ssl">SSL</option>
              <option value="starttls">STARTTLS</option>
              <option value="none">None</option>
            </select>
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <span>SMTP Username</span>
            <Input value={mailForm.smtp_username} onChange={(event) => updateMailForm({ smtp_username: event.target.value })} placeholder="(optional) sonst IMAP Username" />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <span>SMTP Passwort</span>
            <Input
              type="password"
              autoComplete="new-password"
              value={mailForm.smtp_password}
              onChange={(event) => updateMailForm({ smtp_password: event.target.value })}
              placeholder="(optional) sonst IMAP Passwort"
            />
          </label>

          <div className="grid gap-2 md:grid-cols-3">
            <label className="space-y-1 text-sm text-zinc-200 md:col-span-2">
              <span>SMTP Host</span>
              <Input value={mailForm.smtp_host} onChange={(event) => updateMailForm({ smtp_host: event.target.value })} placeholder="smtp.example.com" />
            </label>
            <label className="space-y-1 text-sm text-zinc-200">
              <span>SMTP Port</span>
              <Input
                type="number"
                value={mailForm.smtp_port}
                onChange={(event) => updateMailForm({ smtp_port: Number(event.target.value) })}
                placeholder="465"
              />
            </label>
          </div>

          <label className="space-y-1 text-sm text-zinc-200">
            <span>SMTP Security</span>
            <select
              className="w-full rounded-md border border-white/15 bg-black/35 px-2 py-1.5 text-sm"
              value={mailForm.smtp_security}
              onChange={(event) => updateMailForm({ smtp_security: event.target.value as any })}
            >
              <option value="ssl">SSL</option>
              <option value="starttls">STARTTLS</option>
              <option value="none">None</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            variant="default"
            onClick={() => createMailAccount.mutate()}
            disabled={createMailAccount.isPending || !mailForm.email_address || !mailForm.imap_host || !mailForm.smtp_host}
          >
            {createMailAccount.isPending ? (
              <>
                <Loader2 size={14} className="mr-2 animate-spin" />
                Wird gespeichert
              </>
            ) : (
              'Email-Konto hinzufuegen'
            )}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              updateMailForm({
                label: '',
                email_address: '',
                imap_username: '',
                imap_password: '',
                smtp_username: '',
                smtp_password: '',
              })
            }
          >
            Formular leeren
          </Button>
        </div>

        <div className="mt-5 space-y-2 rounded-xl border border-white/10 bg-black/25 p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-zinc-100">Ihre Email-Konten</p>
            {mailAccountsQuery.isLoading ? (
              <span className="inline-flex items-center gap-2 text-xs text-zinc-400">
                <Loader2 size={12} className="animate-spin" />
                laedt
              </span>
            ) : null}
          </div>

          {mailAccounts.length === 0 && !mailAccountsQuery.isLoading ? (
            <p className="text-xs text-zinc-400">Noch kein Konto verbunden.</p>
          ) : null}

          <div className="space-y-2">
            {mailAccounts.map((account) => (
              <div key={account.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-zinc-100">
                    {account.label ? `${account.label} · ` : ''}
                    {account.email_address}
                  </p>
                  <p className="text-xs text-zinc-400">
                    IMAP: {account.imap_host}:{account.imap_port} · SMTP: {account.smtp_host}:{account.smtp_port}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Button size="sm" variant="secondary" onClick={() => navigate(`/app/email?accountId=${account.id}`)}>
                    Oeffnen
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => testMailAccount.mutate(account.id)}
                    disabled={testMailAccount.isPending}
                  >
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => {
                      if (!confirm('Email-Konto wirklich entfernen?')) return;
                      deleteMailAccount.mutate(account.id);
                    }}
                    disabled={deleteMailAccount.isPending}
                  >
                    Entfernen
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles size={16} className="text-cyan-300" />
          <h2 className="text-lg font-semibold">Performance</h2>
        </div>

        <div className="space-y-3">
          <div>
            <p className="mb-2 text-sm text-zinc-300">Effektqualität</p>
            <div className="flex flex-wrap gap-2">
              {qualityOptions.map((quality) => (
                <Button
                  key={quality}
                  size="sm"
                  variant={prefs.effectsQuality === quality ? 'default' : 'secondary'}
                  onClick={() => setEffectsQuality(quality)}
                >
                  {quality === 'low' ? 'Niedrig' : quality === 'medium' ? 'Mittel' : 'Hoch'}
                </Button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-zinc-200">
            <input
              type="checkbox"
              checked={prefs.animationsEnabled}
              onChange={(event) => setAnimationsEnabled(event.target.checked)}
            />
            Animationen aktivieren
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="mb-4 flex items-center gap-2">
          <Paintbrush size={16} className="text-cyan-300" />
          <h2 className="text-lg font-semibold">Design & Größe</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm text-zinc-200">
            <div className="flex items-center justify-between">
              <span>Eckenrundung</span>
              <span className="text-zinc-400">{prefs.cornerRadius}px</span>
            </div>
            <input
              type="range"
              min={10}
              max={40}
              value={prefs.cornerRadius}
              onChange={(event) => updatePrefs({ cornerRadius: Number(event.target.value) })}
            />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <div className="flex items-center justify-between">
              <span>UI-Skalierung</span>
              <span className="text-zinc-400">{Math.round(prefs.uiScale * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.9}
              max={1.15}
              step={0.01}
              value={prefs.uiScale}
              onChange={(event) => updatePrefs({ uiScale: Number(event.target.value) })}
            />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <div className="flex items-center justify-between">
              <span>Panel-Transparenz</span>
              <span className="text-zinc-400">{Math.round(prefs.panelOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={0.05}
              max={0.25}
              step={0.01}
              value={prefs.panelOpacity}
              onChange={(event) => updatePrefs({ panelOpacity: Number(event.target.value) })}
            />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <div className="flex items-center justify-between">
              <span>Akzentfarbe (Hue)</span>
              <span className="text-zinc-400">{prefs.accentHue}°</span>
            </div>
            <input
              type="range"
              min={0}
              max={359}
              value={prefs.accentHue}
              onChange={(event) => updatePrefs({ accentHue: Number(event.target.value) })}
            />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <div className="flex items-center justify-between">
              <span>Akzent-Sättigung</span>
              <span className="text-zinc-400">{prefs.accentSaturation}%</span>
            </div>
            <input
              type="range"
              min={35}
              max={100}
              value={prefs.accentSaturation}
              onChange={(event) => updatePrefs({ accentSaturation: Number(event.target.value) })}
            />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <div className="flex items-center justify-between">
              <span>Akzent-Helligkeit</span>
              <span className="text-zinc-400">{prefs.accentLightness}%</span>
            </div>
            <input
              type="range"
              min={35}
              max={85}
              value={prefs.accentLightness}
              onChange={(event) => updatePrefs({ accentLightness: Number(event.target.value) })}
            />
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="mb-4 flex items-center gap-2">
          <SlidersHorizontal size={16} className="text-cyan-300" />
          <h2 className="text-lg font-semibold">Dock & Navigation</h2>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-1 text-sm text-zinc-200">
            <span>Dock-Position</span>
            <select
              className="w-full rounded-md border border-white/15 bg-black/35 px-2 py-1.5 text-sm"
              value={prefs.dockPosition}
              onChange={(event) => updatePrefs({ dockPosition: event.target.value as 'bottom' | 'left' | 'right' })}
            >
              <option value="bottom">Unten</option>
              <option value="left">Links</option>
              <option value="right">Rechts</option>
            </select>
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <div className="flex items-center justify-between">
              <span>Abstand zum Rand</span>
              <span className="text-zinc-400">{prefs.dockEdgeOffset}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={48}
              value={prefs.dockEdgeOffset}
              onChange={(event) => updatePrefs({ dockEdgeOffset: Number(event.target.value) })}
            />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <div className="flex items-center justify-between">
              <span>Icon-Größe</span>
              <span className="text-zinc-400">{prefs.dockBaseItemSize}px</span>
            </div>
            <input
              type="range"
              min={40}
              max={64}
              value={prefs.dockBaseItemSize}
              onChange={(event) => updatePrefs({ dockBaseItemSize: Number(event.target.value) })}
            />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <div className="flex items-center justify-between">
              <span>Vergrößerung</span>
              <span className="text-zinc-400">{prefs.dockMagnification}px</span>
            </div>
            <input
              type="range"
              min={54}
              max={96}
              value={prefs.dockMagnification}
              onChange={(event) => updatePrefs({ dockMagnification: Number(event.target.value) })}
            />
          </label>

          <label className="space-y-1 text-sm text-zinc-200">
            <div className="flex items-center justify-between">
              <span>Panel-Höhe</span>
              <span className="text-zinc-400">{prefs.dockPanelHeight}px</span>
            </div>
            <input
              type="range"
              min={52}
              max={84}
              value={prefs.dockPanelHeight}
              onChange={(event) => updatePrefs({ dockPanelHeight: Number(event.target.value) })}
            />
          </label>
        </div>

        <div className="mt-4 space-y-2 rounded-xl border border-white/10 bg-black/25 p-3">
          <p className="text-sm font-medium text-zinc-100">Dock-Reihenfolge</p>
          <p className="text-xs text-zinc-400">Sortieren Sie Ihre Navigation individuell (oben = früher angezeigt).</p>
          <div className="space-y-1.5">
            {dockOrder.map((path, index) => {
              const label = DOCK_ENTRIES.find((entry) => entry.path === path)?.label ?? path;
              return (
                <div key={path} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
                  <span className="text-sm text-zinc-100">{label}</span>
                  <div className="flex items-center gap-1">
                    <Button size="icon" variant="secondary" onClick={() => moveDockEntry(path, -1)} disabled={index === 0}>
                      <ArrowUp size={13} />
                    </Button>
                    <Button
                      size="icon"
                      variant="secondary"
                      onClick={() => moveDockEntry(path, 1)}
                      disabled={index === dockOrder.length - 1}
                    >
                      <ArrowDown size={13} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {canUseStudio ? (
        <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
          <h2 className="mb-3 text-lg font-semibold">Entwicklung</h2>
          <p className="mb-3 text-sm text-zinc-300">Öffnen Sie Ihr PondSec Cloud Pro Studio für Projekte und Code.</p>
          <Button variant="secondary" onClick={() => navigate('/dev/workspaces')}>
            Studio öffnen
          </Button>
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <h2 className="mb-3 text-lg font-semibold">Shortcuts</h2>
        <p className="mb-2 text-xs text-zinc-400">
          {isMac ? 'Mac-Hinweis: Zusätzlich funktionieren Ctrl+1 bis Ctrl+5 als sichere Fallback-Kürzel.' : 'Shortcuts für schnelle Navigation in allen Kernbereichen.'}
        </p>
        <div className="flex flex-wrap gap-2 text-xs">
          {APP_SHORTCUTS.map((entry) => (
            <span key={entry.id} className="rounded-full border border-white/15 bg-black/25 px-3 py-1 text-zinc-200">
              {comboForPlatform(entry, isMac)} · {entry.label}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
