import { Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useUiPrefs, type EffectsQuality } from '@/contexts/UiPrefsContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { APP_SHORTCUTS, BRAND, comboForPlatform } from '@/lib/brand';
import { formatBytes } from '@/lib/utils';

export function SettingsPage() {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const { prefs, setEffectsQuality, setAnimationsEnabled } = useUiPrefs();
  const isMac = useMemo(
    () => (typeof navigator !== 'undefined' ? /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) : false),
    [],
  );

  const qualityOptions: EffectsQuality[] = ['low', 'medium', 'high'];

  return (
    <div className="h-full space-y-6 overflow-auto p-4">
      <div>
        <h1 className="text-2xl font-semibold">Einstellungen</h1>
        <p className="text-sm text-zinc-300">
          {BRAND.fullName} passt sich an Sie an: ruhig, schnell und klar steuerbar.
        </p>
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
          <h2 className="text-lg font-semibold">Performance & Effekte</h2>
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
        <h2 className="mb-3 text-lg font-semibold">Entwicklung</h2>
        <p className="mb-3 text-sm text-zinc-300">Öffnen Sie Ihr PondSec Cloud Pro Studio für Projekte und Code.</p>
        <Button variant="secondary" onClick={() => navigate('/dev/workspaces')}>
          Studio öffnen
        </Button>
      </section>

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
