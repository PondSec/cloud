import { Keyboard } from 'lucide-react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { DockNav } from '@/components/app/DockNav';
import GlassSurface from '@/components/reactbits/GlassSurface';
import LightPillar from '@/components/reactbits/LightPillar';
import { useUiPrefs } from '@/contexts/UiPrefsContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { APP_SHORTCUTS, BRAND, type AppShortcutId, comboForPlatform } from '@/lib/brand';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

export function AppShell() {
  const { prefs } = useUiPrefs();
  const { effectsQuality, animationsEnabled } = prefs;
  const navigate = useNavigate();
  const location = useLocation();
  const { data: user } = useCurrentUser();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const isMac = useMemo(
    () => (typeof navigator !== 'undefined' ? /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent) : false),
    [],
  );
  const sectionLabel = (() => {
    if (location.pathname.startsWith('/app/home')) return 'Start';
    if (location.pathname.startsWith('/app/files')) return 'Dateien';
    if (location.pathname.startsWith('/app/search')) return 'Suche';
    if (location.pathname.startsWith('/app/recents')) return 'Zuletzt';
    if (location.pathname.startsWith('/app/shared')) return 'Freigaben';
    if (location.pathname.startsWith('/app/media')) return 'Medien';
    if (location.pathname.startsWith('/app/email')) return 'Email';
    if (location.pathname.startsWith('/app/settings')) return 'Einstellungen';
    if (location.pathname.startsWith('/app/admin')) return 'Verwaltung';
    if (location.pathname.startsWith('/app/monitoring')) return 'System';
    if (location.pathname.startsWith('/dev')) return 'Studio';
    return 'Bereich';
  })();

  const runShortcut = (id: AppShortcutId) => {
    if (id === 'home') {
      navigate('/app/home');
      return;
    }
    if (id === 'files') {
      if (!hasPermission(user, PERMISSIONS.FILE_READ)) return;
      navigate('/app/files');
      return;
    }
    if (id === 'search') {
      if (!hasPermission(user, PERMISSIONS.FILE_READ)) return;
      navigate('/app/search');
      return;
    }
    if (id === 'media') {
      if (!hasPermission(user, PERMISSIONS.FILE_READ) || !hasPermission(user, PERMISSIONS.MEDIA_VIEW)) return;
      navigate('/app/media');
      return;
    }
    navigate('/app/settings');
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target.isContentEditable) return;
      }

      const code = event.code;

      const altOnly = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      const ctrlOnly = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
      const cmdAlt = event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey;

      if (altOnly || cmdAlt) {
        if (code === 'KeyH') {
          event.preventDefault();
          runShortcut('home');
          return;
        }
        if (code === 'KeyF') {
          event.preventDefault();
          runShortcut('files');
          return;
        }
        if (code === 'KeyS') {
          event.preventDefault();
          runShortcut('search');
          return;
        }
        if (code === 'KeyM') {
          event.preventDefault();
          runShortcut('media');
          return;
        }
        if (code === 'Comma' || event.key === ',') {
          event.preventDefault();
          runShortcut('settings');
          return;
        }
      }

      // Mac/Keyboard fallback: Ctrl+1..5 (works even when Option combos are intercepted).
      if (ctrlOnly && ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(code)) {
        event.preventDefault();
        if (code === 'Digit1') runShortcut('home');
        if (code === 'Digit2') runShortcut('files');
        if (code === 'Digit3') runShortcut('search');
        if (code === 'Digit4') runShortcut('media');
        if (code === 'Digit5') runShortcut('settings');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, user]);

  useEffect(() => {
    setShortcutsOpen(false);
  }, [location.pathname]);

  const accentHue = prefs.accentHue;
  const accentHsl = `${prefs.accentHue} ${prefs.accentSaturation}% ${prefs.accentLightness}%`;
  const accentColor = `hsl(${accentHsl})`;
  const secondaryHue = (accentHue + 135) % 360;
  const secondaryColor = `hsl(${secondaryHue} 84% 72%)`;
  const shellStyle = useMemo<CSSProperties>(
    () =>
      ({
        '--cloud-accent-hsl': accentHsl,
        '--cloud-corner-radius': `${prefs.cornerRadius}px`,
        '--cloud-ui-scale': String(prefs.uiScale),
        '--cloud-panel-opacity': String(prefs.panelOpacity),
      }) as CSSProperties,
    [accentHsl, prefs.cornerRadius, prefs.panelOpacity, prefs.uiScale],
  );
  const paneRadius = Math.max(10, prefs.cornerRadius - 2);
  const panelBackground = `hsl(228 54% 9% / ${Math.max(0.1, Math.min(0.9, prefs.panelOpacity + 0.56))})`;

  return (
    <div className="cloud-theme-root relative min-h-screen overflow-hidden pb-24" style={shellStyle}>
      <div className="pointer-events-none absolute inset-0">
        <LightPillar
          topColor={accentColor}
          bottomColor={secondaryColor}
          intensity={effectsQuality === 'low' ? 0.26 : 0.36}
          rotationSpeed={animationsEnabled ? 0.11 : 0}
          glowAmount={effectsQuality === 'high' ? 0.003 : 0.0016}
          pillarWidth={3.2}
          pillarHeight={0.42}
          noiseIntensity={effectsQuality === 'low' ? 0.1 : 0.26}
          pillarRotation={18}
          interactive={false}
          mixBlendMode="screen"
          quality={effectsQuality}
        />
      </div>

      <main className="relative z-10 mx-auto h-screen w-full max-w-[1600px] p-4 pb-24 sm:p-6 sm:pb-24">
        <GlassSurface
          width="100%"
          height="100%"
          borderRadius={prefs.cornerRadius + 6}
          backgroundOpacity={0.1}
          saturation={1.6}
          className="h-full border border-white/20"
          displace={0.42}
        >
          <div className="h-full w-full overflow-hidden border border-white/10" style={{ borderRadius: paneRadius, backgroundColor: panelBackground }}>
            <div className="group border-b border-white/10 bg-black/20">
              <div className="flex items-center justify-between gap-2 px-4 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-100">{BRAND.fullName}</p>
                  <p className="hidden text-[11px] text-zinc-400 md:block">{BRAND.trustLine}</p>
                </div>

                <div className="flex items-center gap-2">
                  <span className="hidden rounded-full border border-white/15 bg-black/20 px-2 py-1 text-[11px] text-zinc-300 sm:inline">
                    {sectionLabel}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShortcutsOpen((prev) => !prev)}
                    className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/25 px-2 py-1 text-[11px] text-zinc-300 transition hover:border-cyan-300/40 hover:text-cyan-100"
                  >
                    <Keyboard size={12} />
                    Kurzbefehle
                  </button>
                </div>
              </div>

              <div
                className={cn(
                  'overflow-hidden transition-all duration-300',
                  shortcutsOpen ? 'max-h-28 opacity-100' : 'max-h-0 opacity-0 group-hover:max-h-28 group-hover:opacity-100',
                )}
              >
                <div className="flex flex-wrap gap-1.5 px-4 pb-2">
                  {APP_SHORTCUTS.map((entry) => (
                    <span
                      key={entry.id}
                      className="rounded-full border border-white/15 bg-black/25 px-2 py-1 text-[11px] text-zinc-300"
                    >
                      {comboForPlatform(entry, isMac)} · {entry.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <ErrorBoundary>
              <Outlet />
            </ErrorBoundary>
          </div>
        </GlassSurface>
      </main>

      <DockNav />
    </div>
  );
}
