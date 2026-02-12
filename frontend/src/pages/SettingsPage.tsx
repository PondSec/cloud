import { Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { useUiPrefs, type EffectsQuality } from '@/contexts/UiPrefsContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { formatBytes } from '@/lib/utils';

export function SettingsPage() {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();
  const { prefs, setEffectsQuality, setAnimationsEnabled } = useUiPrefs();

  const qualityOptions: EffectsQuality[] = ['low', 'medium', 'high'];

  return (
    <div className="h-full space-y-6 overflow-auto p-4">
      <div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm text-zinc-300">Profile and visual quality preferences.</p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <h2 className="mb-3 text-lg font-semibold">Account</h2>
        <div className="grid gap-2 text-sm text-zinc-200">
          <p>
            Username: <span className="text-cyan-200">{user?.username}</span>
          </p>
          <p>
            Storage used: {formatBytes(user?.bytes_used ?? 0)} / {formatBytes(user?.bytes_limit ?? 0)}
          </p>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="mb-4 flex items-center gap-2">
          <Sparkles size={16} className="text-cyan-300" />
          <h2 className="text-lg font-semibold">Performance & Effects</h2>
        </div>

        <div className="space-y-3">
          <div>
            <p className="mb-2 text-sm text-zinc-300">LightPillar / MagicBento quality</p>
            <div className="flex flex-wrap gap-2">
              {qualityOptions.map((quality) => (
                <Button
                  key={quality}
                  size="sm"
                  variant={prefs.effectsQuality === quality ? 'default' : 'secondary'}
                  onClick={() => setEffectsQuality(quality)}
                >
                  {quality}
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
            Enable animations and particle effects
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <h2 className="mb-3 text-lg font-semibold">Development</h2>
        <p className="mb-3 text-sm text-zinc-300">Open the integrated Cloud IDE area for coding projects.</p>
        <Button variant="secondary" onClick={() => navigate('/dev/workspaces')}>
          Open Cloud IDE
        </Button>
      </section>
    </div>
  );
}
