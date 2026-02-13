import { ArrowDown, ArrowUp, Loader2, Paintbrush, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useUiPrefs, type EffectsQuality } from '@/contexts/UiPrefsContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
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
  { path: '/dev/workspaces', label: 'Studio' },
  { path: '/app/admin', label: 'Verwaltung' },
  { path: '/app/monitoring', label: 'System' },
  { path: '/app/settings', label: 'Einstellungen' },
  { path: '/app/inventorypro', label: 'Inventory Pro' },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const { prefs, isLoaded, isSyncing, setEffectsQuality, setAnimationsEnabled, updatePrefs, setDockOrder, resetPrefs } = useUiPrefs();
  const isMac = useMemo(
    () => (typeof navigator !== 'undefined' ? /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) : false),
    [],
  );
  const canUseStudio = hasPermission(user, PERMISSIONS.IDE_USE);

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
