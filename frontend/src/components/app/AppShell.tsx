import { Keyboard } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { DockNav } from '@/components/app/DockNav';
import GlassSurface from '@/components/reactbits/GlassSurface';
import LightPillar from '@/components/reactbits/LightPillar';
import { useUiPrefs } from '@/contexts/UiPrefsContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { APP_SHORTCUTS, BRAND, type AppShortcutId, comboForPlatform } from '@/lib/brand';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

export function AppShell() {
  const {
    prefs: { effectsQuality, animationsEnabled },
  } = useUiPrefs();
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

      const key = event.key.toLowerCase();

      const altOnly = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      const ctrlOnly = event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
      const cmdAlt = event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey;

      if (altOnly || cmdAlt) {
        if (key === 'h') {
          event.preventDefault();
          runShortcut('home');
          return;
        }
        if (key === 'f') {
          event.preventDefault();
          runShortcut('files');
          return;
        }
        if (key === 's') {
          event.preventDefault();
          runShortcut('search');
          return;
        }
        if (key === 'm') {
          event.preventDefault();
          runShortcut('media');
          return;
        }
        if (event.key === ',') {
          event.preventDefault();
          runShortcut('settings');
          return;
        }
      }

      // Mac/Keyboard fallback: Ctrl+1..5 (works even when Option combos are intercepted).
      if (ctrlOnly && ['1', '2', '3', '4', '5'].includes(key)) {
        event.preventDefault();
        if (key === '1') runShortcut('home');
        if (key === '2') runShortcut('files');
        if (key === '3') runShortcut('search');
        if (key === '4') runShortcut('media');
        if (key === '5') runShortcut('settings');
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [navigate, user]);

  useEffect(() => {
    setShortcutsOpen(false);
  }, [location.pathname]);

  return (
    <div className="relative min-h-screen overflow-hidden pb-24">
      <div className="pointer-events-none absolute inset-0">
        <LightPillar
          topColor="#4FD8FF"
          bottomColor="#FF80CE"
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
          borderRadius={28}
          backgroundOpacity={0.1}
          saturation={1.6}
          className="h-full border border-white/20"
          displace={0.42}
        >
          <div className="h-full w-full overflow-hidden rounded-[24px] border border-white/10 bg-[#090d22b3]">
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
            <Outlet />
          </div>
        </GlassSurface>
      </main>

      <DockNav />
    </div>
  );
}
