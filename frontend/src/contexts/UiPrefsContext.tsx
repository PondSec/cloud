import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { AUTH_STORAGE_EVENT, getAccessToken } from '@/lib/auth-storage';
import type { UiPreferences } from '@/types/api';

export type EffectsQuality = UiPreferences['effectsQuality'];

export const DEFAULT_DOCK_ORDER = [
  '/app/home',
  '/app/files',
  '/app/search',
  '/app/recents',
  '/app/shared',
  '/app/media',
  '/dev/workspaces',
  '/app/admin',
  '/app/monitoring',
  '/app/settings',
  '/app/inventorypro',
] as const;

const STORAGE_KEY_PREFIX = 'cloud_workspace_ui_prefs_user_';
const GUEST_STORAGE_KEY = 'cloud_workspace_ui_prefs_guest';

interface UiPreferencesContextValue {
  prefs: UiPreferences;
  isLoaded: boolean;
  isSyncing: boolean;
  setEffectsQuality: (quality: EffectsQuality) => void;
  setAnimationsEnabled: (enabled: boolean) => void;
  updatePrefs: (patch: Partial<UiPreferences>) => void;
  setDockOrder: (order: string[]) => void;
  resetPrefs: () => void;
}

const UiPrefsContext = createContext<UiPreferencesContextValue | null>(null);

function defaultPreferences(): UiPreferences {
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  const lowCpu = navigator.hardwareConcurrency <= 4;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    effectsQuality: isMobile || lowCpu ? 'low' : 'medium',
    animationsEnabled: !reducedMotion,
    cornerRadius: 22,
    panelOpacity: 0.1,
    uiScale: 1,
    accentHue: 188,
    accentSaturation: 88,
    accentLightness: 70,
    dockPosition: 'bottom',
    dockEdgeOffset: 0,
    dockBaseItemSize: 48,
    dockMagnification: 68,
    dockPanelHeight: 62,
    dockOrder: [...DEFAULT_DOCK_ORDER],
  };
}

function clampInt(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

function clampFloat(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function normalizeDockOrder(order: unknown): string[] {
  const allowed = new Set<string>(DEFAULT_DOCK_ORDER);
  if (!Array.isArray(order)) return [...DEFAULT_DOCK_ORDER];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of order) {
    if (typeof entry !== 'string') continue;
    const path = entry.trim();
    if (!allowed.has(path) || seen.has(path)) continue;
    seen.add(path);
    normalized.push(path);
  }
  for (const fallback of DEFAULT_DOCK_ORDER) {
    if (seen.has(fallback)) continue;
    normalized.push(fallback);
  }
  return normalized;
}

function sanitizePreferences(input: Partial<UiPreferences> | null | undefined, fallback: UiPreferences): UiPreferences {
  const source = input ?? {};
  const quality = source.effectsQuality;
  const dockPosition = source.dockPosition;
  return {
    effectsQuality: quality === 'low' || quality === 'medium' || quality === 'high' ? quality : fallback.effectsQuality,
    animationsEnabled: typeof source.animationsEnabled === 'boolean' ? source.animationsEnabled : fallback.animationsEnabled,
    cornerRadius: clampInt(source.cornerRadius, 10, 40, fallback.cornerRadius),
    panelOpacity: clampFloat(source.panelOpacity, 0.05, 0.25, fallback.panelOpacity),
    uiScale: clampFloat(source.uiScale, 0.9, 1.15, fallback.uiScale),
    accentHue: clampInt(source.accentHue, 0, 359, fallback.accentHue),
    accentSaturation: clampInt(source.accentSaturation, 35, 100, fallback.accentSaturation),
    accentLightness: clampInt(source.accentLightness, 35, 85, fallback.accentLightness),
    dockPosition: dockPosition === 'left' || dockPosition === 'right' || dockPosition === 'bottom' ? dockPosition : fallback.dockPosition,
    dockEdgeOffset: clampInt(source.dockEdgeOffset, 0, 48, fallback.dockEdgeOffset),
    dockBaseItemSize: clampInt(source.dockBaseItemSize, 40, 64, fallback.dockBaseItemSize),
    dockMagnification: clampInt(source.dockMagnification, 54, 96, fallback.dockMagnification),
    dockPanelHeight: clampInt(source.dockPanelHeight, 52, 84, fallback.dockPanelHeight),
    dockOrder: normalizeDockOrder(source.dockOrder),
  };
}

function readStoredPreferences(storageKey: string): UiPreferences | null {
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<UiPreferences>;
    return sanitizePreferences(parsed, defaultPreferences());
  } catch {
    return null;
  }
}

export function UiPrefsProvider({ children }: { children: React.ReactNode }) {
  const initial = useMemo(() => {
    const stored = readStoredPreferences(GUEST_STORAGE_KEY);
    return stored ?? defaultPreferences();
  }, []);

  const [prefs, setPrefs] = useState<UiPreferences>(initial);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(() => getAccessToken());

  const prefsRef = useRef<UiPreferences>(initial);
  const storageKeyRef = useRef<string>(GUEST_STORAGE_KEY);
  const hydratedRef = useRef(false);
  const syncTimerRef = useRef<number | null>(null);

  useEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  useEffect(() => {
    const syncToken = () => setAuthToken(getAccessToken());
    const storageListener = (event: StorageEvent) => {
      if (!event.key || event.key.includes('cloud_workspace_access_token') || event.key.includes('cloud_workspace_refresh_token')) {
        syncToken();
      }
    };
    window.addEventListener(AUTH_STORAGE_EVENT, syncToken as EventListener);
    window.addEventListener('storage', storageListener);
    return () => {
      window.removeEventListener(AUTH_STORAGE_EVENT, syncToken as EventListener);
      window.removeEventListener('storage', storageListener);
    };
  }, []);

  useEffect(() => {
    let active = true;
    hydratedRef.current = false;
    setIsLoaded(false);

    const load = async () => {
      if (!authToken) {
        storageKeyRef.current = GUEST_STORAGE_KEY;
        const guest = readStoredPreferences(GUEST_STORAGE_KEY) ?? defaultPreferences();
        if (!active) return;
        setPrefs(guest);
        setIsLoaded(true);
        hydratedRef.current = true;
        return;
      }

      try {
        const response = await api.auth.uiPreferences();
        const userStorageKey = `${STORAGE_KEY_PREFIX}${response.user_id}`;
        const local = readStoredPreferences(userStorageKey) ?? defaultPreferences();
        const merged = { ...local, ...(response.preferences ?? {}) };
        const normalized = sanitizePreferences(merged, defaultPreferences());
        storageKeyRef.current = userStorageKey;
        window.localStorage.setItem(userStorageKey, JSON.stringify(normalized));
        if (!active) return;
        setPrefs(normalized);
      } catch {
        const fallback = readStoredPreferences(storageKeyRef.current) ?? defaultPreferences();
        if (!active) return;
        setPrefs(fallback);
      } finally {
        if (!active) return;
        setIsLoaded(true);
        hydratedRef.current = true;
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [authToken]);

  useEffect(
    () => () => {
      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
      }
    },
    [],
  );

  const persist = useCallback(
    (next: UiPreferences) => {
      const normalized = sanitizePreferences(next, defaultPreferences());
      prefsRef.current = normalized;
      setPrefs(normalized);
      window.localStorage.setItem(storageKeyRef.current, JSON.stringify(normalized));

      if (!authToken || !hydratedRef.current) {
        return;
      }

      if (syncTimerRef.current !== null) {
        window.clearTimeout(syncTimerRef.current);
      }
      syncTimerRef.current = window.setTimeout(() => {
        setIsSyncing(true);
        void api.auth
          .updateUiPreferences(normalized)
          .then((response) => {
            const merged = { ...prefsRef.current, ...(response.preferences ?? {}) };
            const clean = sanitizePreferences(merged, defaultPreferences());
            prefsRef.current = clean;
            setPrefs(clean);
            window.localStorage.setItem(storageKeyRef.current, JSON.stringify(clean));
          })
          .catch(() => {
            // Local copy stays available if backend sync fails.
          })
          .finally(() => setIsSyncing(false));
      }, 280);
    },
    [authToken],
  );

  const updatePrefs = useCallback(
    (patch: Partial<UiPreferences>) => {
      persist({ ...prefsRef.current, ...patch });
    },
    [persist],
  );

  const resetPrefs = useCallback(() => {
    const defaults = defaultPreferences();
    persist(defaults);
  }, [persist]);

  const value = useMemo<UiPreferencesContextValue>(
    () => ({
      prefs,
      isLoaded,
      isSyncing,
      setEffectsQuality: (quality) => updatePrefs({ effectsQuality: quality }),
      setAnimationsEnabled: (enabled) => updatePrefs({ animationsEnabled: enabled }),
      updatePrefs,
      setDockOrder: (order) => updatePrefs({ dockOrder: normalizeDockOrder(order) }),
      resetPrefs,
    }),
    [prefs, isLoaded, isSyncing, updatePrefs, resetPrefs],
  );

  return <UiPrefsContext.Provider value={value}>{children}</UiPrefsContext.Provider>;
}

export function useUiPrefs() {
  const context = useContext(UiPrefsContext);
  if (!context) {
    throw new Error('useUiPrefs muss innerhalb von UiPrefsProvider verwendet werden');
  }
  return context;
}
