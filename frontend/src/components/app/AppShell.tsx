import { Outlet } from 'react-router-dom';

import { DockNav } from '@/components/app/DockNav';
import GlassSurface from '@/components/reactbits/GlassSurface';
import LightPillar from '@/components/reactbits/LightPillar';
import { useUiPrefs } from '@/contexts/UiPrefsContext';

export function AppShell() {
  const {
    prefs: { effectsQuality, animationsEnabled },
  } = useUiPrefs();

  return (
    <div className="relative min-h-screen overflow-hidden pb-24">
      <div className="pointer-events-none absolute inset-0">
        <LightPillar
          topColor="#4FD8FF"
          bottomColor="#FF80CE"
          intensity={effectsQuality === 'low' ? 0.45 : 0.65}
          rotationSpeed={animationsEnabled ? 0.24 : 0}
          glowAmount={effectsQuality === 'high' ? 0.004 : 0.002}
          pillarWidth={3.2}
          pillarHeight={0.42}
          noiseIntensity={effectsQuality === 'low' ? 0.15 : 0.4}
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
            <Outlet />
          </div>
        </GlassSurface>
      </main>

      <DockNav />
    </div>
  );
}
