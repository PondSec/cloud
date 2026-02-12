import { createContext, useContext, useMemo, useState } from 'react';

export type EffectsQuality = 'low' | 'medium' | 'high';

interface UiPreferences {
  effectsQuality: EffectsQuality;
  animationsEnabled: boolean;
}

interface UiPreferencesContextValue {
  prefs: UiPreferences;
  setEffectsQuality: (quality: EffectsQuality) => void;
  setAnimationsEnabled: (enabled: boolean) => void;
}

const STORAGE_KEY = 'cloud_workspace_ui_prefs';

const UiPrefsContext = createContext<UiPreferencesContextValue | null>(null);

function detectDefaults(): UiPreferences {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const lowCpu = navigator.hardwareConcurrency <= 4;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return {
    effectsQuality: isMobile || lowCpu ? 'medium' : 'high',
    animationsEnabled: !reducedMotion,
  };
}

function getInitialPreferences(): UiPreferences {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return detectDefaults();
  }

  try {
    const parsed = JSON.parse(raw) as UiPreferences;
    if (
      parsed.effectsQuality !== 'low' &&
      parsed.effectsQuality !== 'medium' &&
      parsed.effectsQuality !== 'high'
    ) {
      return detectDefaults();
    }
    return parsed;
  } catch {
    return detectDefaults();
  }
}

export function UiPrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<UiPreferences>(getInitialPreferences);

  const persist = (next: UiPreferences) => {
    setPrefs(next);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const value = useMemo<UiPreferencesContextValue>(
    () => ({
      prefs,
      setEffectsQuality: (quality) => persist({ ...prefs, effectsQuality: quality }),
      setAnimationsEnabled: (enabled) => persist({ ...prefs, animationsEnabled: enabled }),
    }),
    [prefs],
  );

  return <UiPrefsContext.Provider value={value}>{children}</UiPrefsContext.Provider>;
}

export function useUiPrefs() {
  const context = useContext(UiPrefsContext);
  if (!context) {
    throw new Error('useUiPrefs must be used within UiPrefsProvider');
  }
  return context;
}
