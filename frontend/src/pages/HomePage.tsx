import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import {
  Clock3,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudRain,
  CloudSnow,
  CloudSun,
  FolderClock,
  GripVertical,
  HardDrive,
  Image as ImageIcon,
  LayoutDashboard,
  Link2,
  Move,
  NotebookPen,
  Palette,
  Plus,
  Search,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { api, toApiMessage } from '@/lib/api';
import { hasPermission, PERMISSIONS } from '@/lib/permissions';
import { formatBytes, formatDate, cn } from '@/lib/utils';
import type { FileNode, FolderTreeNode } from '@/types/api';

const STORAGE_KEY = 'cloud_home_layout_v3';
const LEGACY_STORAGE_KEY = 'cloud_home_widgets_v2';
const GRID_SIZE = 14;

const IMAGE_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  'svg',
  'avif',
  'heic',
  'heif',
]);

type WidgetType = 'welcome' | 'weather' | 'clock' | 'shortcuts' | 'image' | 'recents' | 'storage' | 'notes';
type WidgetSize = 'small' | 'medium' | 'large';
type HomeTheme = 'ocean' | 'sunrise' | 'midnight';
type ImageSourceType = 'url' | 'cloud';

interface BaseWidget {
  id: string;
  type: WidgetType;
  size: WidgetSize;
  x: number;
  y: number;
  layer: number;
}

type HomeWidget =
  | (BaseWidget & {
      type: 'welcome';
      title: string;
      note: string;
    })
  | (BaseWidget & {
      type: 'weather';
      city: string;
    })
  | (BaseWidget & {
      type: 'clock';
    })
  | (BaseWidget & {
      type: 'shortcuts';
    })
  | (BaseWidget & {
      type: 'image';
      source: ImageSourceType;
      image_url: string;
      cloud_file_id: number | null;
      caption: string;
    })
  | (BaseWidget & {
      type: 'recents';
      limit: number;
    })
  | (BaseWidget & {
      type: 'storage';
    })
  | (BaseWidget & {
      type: 'notes';
      text: string;
    });

interface HomePrefs {
  theme: HomeTheme;
  showGrid: boolean;
  snapToGrid: boolean;
  boardHeight: number;
  cardBlur: number;
}

interface HomeLayoutState {
  widgets: HomeWidget[];
  prefs: HomePrefs;
}

interface WeatherPayload {
  city: string;
  tempC: number;
  wind: number;
  code: number;
}

interface DragState {
  widgetId: string;
  size: WidgetSize;
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

type WidgetUpdater = HomeWidget[] | ((prev: HomeWidget[]) => HomeWidget[]);

const DEFAULT_PREFS: HomePrefs = {
  theme: 'ocean',
  showGrid: false,
  snapToGrid: true,
  boardHeight: 800,
  cardBlur: 12,
};

const SIZE_DIMENSIONS: Record<WidgetSize, { width: number; height: number }> = {
  small: { width: 270, height: 170 },
  medium: { width: 370, height: 230 },
  large: { width: 520, height: 310 },
};

const THEME_STYLES: Record<
  HomeTheme,
  {
    name: string;
    shellGradient: string;
    boardGradient: string;
    glowClass: string;
    accentClass: string;
  }
> = {
  ocean: {
    name: 'Ocean Glass',
    shellGradient: 'from-sky-300/5 via-blue-300/5 to-cyan-300/5',
    boardGradient: 'from-[#0d1a2b] via-[#132238] to-[#0e1a30]',
    glowClass: 'from-cyan-300/10 via-blue-300/8 to-sky-300/10',
    accentClass: 'text-cyan-100 border-cyan-300/35 bg-cyan-400/15',
  },
  sunrise: {
    name: 'Sunrise Studio',
    shellGradient: 'from-amber-200/5 via-orange-200/5 to-rose-200/5',
    boardGradient: 'from-[#221716] via-[#312224] to-[#2b1f2b]',
    glowClass: 'from-amber-200/10 via-rose-200/8 to-orange-200/10',
    accentClass: 'text-amber-100 border-amber-300/35 bg-amber-400/15',
  },
  midnight: {
    name: 'Midnight Control',
    shellGradient: 'from-slate-300/5 via-indigo-300/5 to-zinc-300/5',
    boardGradient: 'from-[#0b0f18] via-[#121827] to-[#181a2a]',
    glowClass: 'from-indigo-200/10 via-slate-200/8 to-zinc-200/10',
    accentClass: 'text-indigo-100 border-indigo-300/35 bg-indigo-400/15',
  },
};

const WIDGET_LIBRARY: Array<{
  type: WidgetType;
  label: string;
  description: string;
  requiresFileRead?: boolean;
  icon: JSX.Element;
}> = [
  {
    type: 'welcome',
    label: 'Welcome',
    description: 'Persoenliche Begruessung mit Notiz.',
    icon: <Sparkles size={14} />,
  },
  {
    type: 'weather',
    label: 'Wetter',
    description: 'Live-Wetter fuer jeden Ort.',
    icon: <CloudSun size={14} />,
  },
  {
    type: 'clock',
    label: 'Uhr',
    description: 'Zeit und Datum auf einen Blick.',
    icon: <Clock3 size={14} />,
  },
  {
    type: 'shortcuts',
    label: 'Shortcuts',
    description: 'Schneller Zugriff auf Kernbereiche.',
    icon: <LayoutDashboard size={14} />,
  },
  {
    type: 'image',
    label: 'Bild',
    description: 'URL oder Cloud-Datei-ID anzeigen.',
    icon: <ImageIcon size={14} />,
    requiresFileRead: true,
  },
  {
    type: 'recents',
    label: 'Recents',
    description: 'Zuletzt geaenderte Cloud-Dateien.',
    icon: <FolderClock size={14} />,
    requiresFileRead: true,
  },
  {
    type: 'storage',
    label: 'Storage',
    description: 'Speicherverbrauch deines Kontos.',
    icon: <HardDrive size={14} />,
  },
  {
    type: 'notes',
    label: 'Notiz',
    description: 'Freitext fuer Fokus und TODOs.',
    icon: <NotebookPen size={14} />,
  },
];

function createId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parsePositiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : null;
}

function isWidgetSize(value: unknown): value is WidgetSize {
  return value === 'small' || value === 'medium' || value === 'large';
}

function isWidgetType(value: unknown): value is WidgetType {
  return (
    value === 'welcome' ||
    value === 'weather' ||
    value === 'clock' ||
    value === 'shortcuts' ||
    value === 'image' ||
    value === 'recents' ||
    value === 'storage' ||
    value === 'notes'
  );
}

function isHomeTheme(value: unknown): value is HomeTheme {
  return value === 'ocean' || value === 'sunrise' || value === 'midnight';
}

function normalizePrefs(candidate: unknown): HomePrefs {
  if (!candidate || typeof candidate !== 'object') return DEFAULT_PREFS;

  const value = candidate as Record<string, unknown>;
  const boardHeight = clamp(Number(value.boardHeight) || DEFAULT_PREFS.boardHeight, 620, 1400);
  const cardBlur = clamp(Number(value.cardBlur) || DEFAULT_PREFS.cardBlur, 0, 28);

  return {
    theme: isHomeTheme(value.theme) ? value.theme : DEFAULT_PREFS.theme,
    showGrid: value.showGrid === undefined ? DEFAULT_PREFS.showGrid : Boolean(value.showGrid),
    snapToGrid: value.snapToGrid === undefined ? DEFAULT_PREFS.snapToGrid : Boolean(value.snapToGrid),
    boardHeight,
    cardBlur,
  };
}

function defaultPlacement(index: number, size: WidgetSize): Pick<BaseWidget, 'x' | 'y' | 'layer'> {
  const columns = 3;
  const col = index % columns;
  const row = Math.floor(index / columns);
  const x = 24 + col * 390;
  const y = 24 + row * 250;
  return { x, y, layer: index + 1 };
}

function normalizeWidget(entry: unknown, index: number): HomeWidget | null {
  if (!entry || typeof entry !== 'object') return null;

  const value = entry as Record<string, unknown>;
  if (!isWidgetType(value.type)) return null;

  const size: WidgetSize = isWidgetSize(value.size) ? value.size : 'medium';
  const fallbackPlacement = defaultPlacement(index, size);

  const id = typeof value.id === 'string' ? value.id : createId();
  const x = Number.isFinite(Number(value.x)) ? Number(value.x) : fallbackPlacement.x;
  const y = Number.isFinite(Number(value.y)) ? Number(value.y) : fallbackPlacement.y;
  const layer = Number.isFinite(Number(value.layer)) ? Number(value.layer) : fallbackPlacement.layer;

  const base = {
    id,
    type: value.type,
    size,
    x,
    y,
    layer,
  } as BaseWidget;

  if (value.type === 'welcome') {
    return {
      ...base,
      type: 'welcome',
      title: String(value.title ?? 'Willkommen'),
      note: String(value.note ?? 'Baue dir ein Home, das genau zu deinem Workflow passt.'),
    };
  }

  if (value.type === 'weather') {
    return {
      ...base,
      type: 'weather',
      city: String(value.city ?? 'Berlin'),
    };
  }

  if (value.type === 'clock') {
    return {
      ...base,
      type: 'clock',
    };
  }

  if (value.type === 'shortcuts') {
    return {
      ...base,
      type: 'shortcuts',
    };
  }

  if (value.type === 'image') {
    const source: ImageSourceType = value.source === 'cloud' ? 'cloud' : 'url';
    return {
      ...base,
      type: 'image',
      source,
      image_url: String(value.image_url ?? ''),
      cloud_file_id: parsePositiveInt(value.cloud_file_id),
      caption: String(value.caption ?? ''),
    };
  }

  if (value.type === 'recents') {
    const rawLimit = Number(value.limit);
    return {
      ...base,
      type: 'recents',
      limit: Number.isFinite(rawLimit) ? clamp(Math.trunc(rawLimit), 3, 12) : 5,
    };
  }

  if (value.type === 'storage') {
    return {
      ...base,
      type: 'storage',
    };
  }

  return {
    ...base,
    type: 'notes',
    text: String(value.text ?? 'Deine Notiz...'),
  };
}

function normalizeWidgets(candidate: unknown): HomeWidget[] {
  if (!Array.isArray(candidate)) return [];

  const normalized: HomeWidget[] = [];
  for (let index = 0; index < candidate.length; index += 1) {
    const widget = normalizeWidget(candidate[index], index);
    if (widget) normalized.push(widget);
  }
  return normalized;
}

function buildStarterWidgets(): HomeWidget[] {
  return [
    {
      id: createId(),
      type: 'welcome',
      size: 'large',
      x: 24,
      y: 24,
      layer: 1,
      title: 'Willkommen zur neuen Home-Ansicht',
      note: 'Zieh Widgets per Handle, passe Design/Theme an und baue dein Dashboard so, wie es fuer dich passt.',
    },
    {
      id: createId(),
      type: 'weather',
      size: 'medium',
      x: 570,
      y: 24,
      layer: 2,
      city: 'Berlin',
    },
    {
      id: createId(),
      type: 'clock',
      size: 'small',
      x: 970,
      y: 24,
      layer: 3,
    },
    {
      id: createId(),
      type: 'shortcuts',
      size: 'small',
      x: 970,
      y: 220,
      layer: 4,
    },
    {
      id: createId(),
      type: 'recents',
      size: 'medium',
      x: 570,
      y: 270,
      layer: 5,
      limit: 5,
    },
    {
      id: createId(),
      type: 'storage',
      size: 'small',
      x: 970,
      y: 420,
      layer: 6,
    },
    {
      id: createId(),
      type: 'notes',
      size: 'small',
      x: 24,
      y: 350,
      layer: 7,
      text: 'Fokus heute:\n- Team-Review\n- Build pruefen\n- Wichtige Dateien sortieren',
    },
  ];
}

function loadLayoutState(): HomeLayoutState {
  const fallback: HomeLayoutState = {
    widgets: buildStarterWidgets(),
    prefs: DEFAULT_PREFS,
  };

  if (typeof window === 'undefined') return fallback;

  const parseContainer = (raw: string | null): HomeLayoutState | null => {
    if (!raw) return null;

    try {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return {
          widgets: normalizeWidgets(parsed),
          prefs: DEFAULT_PREFS,
        };
      }

      if (!parsed || typeof parsed !== 'object') return null;

      const container = parsed as Record<string, unknown>;
      return {
        widgets: normalizeWidgets(container.widgets),
        prefs: normalizePrefs(container.prefs),
      };
    } catch {
      return null;
    }
  };

  const current = parseContainer(window.localStorage.getItem(STORAGE_KEY));
  if (current) {
    return {
      widgets: current.widgets,
      prefs: current.prefs,
    };
  }

  const legacy = parseContainer(window.localStorage.getItem(LEGACY_STORAGE_KEY));
  if (legacy && legacy.widgets.length > 0) {
    return legacy;
  }

  return fallback;
}

function getWidgetDimensions(size: WidgetSize, boardWidth: number): { width: number; height: number } {
  const base = SIZE_DIMENSIONS[size];
  const maxWidth = Math.max(230, boardWidth - 18);

  return {
    width: Math.min(base.width, maxWidth),
    height: base.height,
  };
}

function clampPosition(
  size: WidgetSize,
  x: number,
  y: number,
  boardWidth: number,
  boardHeight: number,
  snap: boolean,
): { x: number; y: number } {
  const dimensions = getWidgetDimensions(size, boardWidth);
  let nextX = x;
  let nextY = y;

  if (snap) {
    nextX = Math.round(nextX / GRID_SIZE) * GRID_SIZE;
    nextY = Math.round(nextY / GRID_SIZE) * GRID_SIZE;
  }

  const maxX = Math.max(0, boardWidth - dimensions.width - 8);
  const maxY = Math.max(0, boardHeight - dimensions.height - 8);

  return {
    x: clamp(nextX, 0, maxX),
    y: clamp(nextY, 0, maxY),
  };
}

function suggestPlacement(
  widgets: HomeWidget[],
  size: WidgetSize,
  boardWidth: number,
  boardHeight: number,
  layer: number,
): Pick<BaseWidget, 'x' | 'y' | 'layer'> {
  const safeBoardWidth = boardWidth > 0 ? boardWidth : 1280;
  const index = widgets.length;
  const colCount = Math.max(1, Math.floor((safeBoardWidth - 20) / 360));
  const col = index % colCount;
  const row = Math.floor(index / colCount);

  const candidateX = 20 + col * 360;
  const candidateY = 20 + row * 220;

  const clamped = clampPosition(size, candidateX, candidateY, safeBoardWidth, boardHeight, false);
  return {
    x: clamped.x,
    y: clamped.y,
    layer,
  };
}

function sizeLabel(size: WidgetSize): string {
  if (size === 'small') return 'Klein';
  if (size === 'large') return 'Gross';
  return 'Mittel';
}

function widgetTypeLabel(type: WidgetType): string {
  const entry = WIDGET_LIBRARY.find((item) => item.type === type);
  return entry ? entry.label : type;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

function isImageFile(node: FileNode): boolean {
  const mime = node.mime?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(extensionOf(node.name));
}

function collectFolderIds(nodes: FolderTreeNode[]): number[] {
  const ids: number[] = [];
  const stack = [...nodes];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    ids.push(current.id);
    for (const child of current.children) {
      stack.push(child);
    }
  }
  return ids;
}

async function loadAllFileNodes(): Promise<FileNode[]> {
  const folderTree = await api.files.tree();
  const folderIds = collectFolderIds(folderTree);
  const parentIds: Array<number | null> = [null, ...folderIds];
  const children = await Promise.all(parentIds.map((parentId) => api.files.list(parentId)));
  const fileMap = new Map<number, FileNode>();

  for (const items of children) {
    for (const item of items) {
      if (item.type !== 'file') continue;
      fileMap.set(item.id, item);
    }
  }

  return [...fileMap.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

async function loadCloudImageNodes(): Promise<FileNode[]> {
  const all = await loadAllFileNodes();
  return all.filter((node) => isImageFile(node));
}

async function fetchWeather(city: string): Promise<WeatherPayload> {
  const geocoding = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=de&format=json`,
  );
  if (!geocoding.ok) throw new Error('Geocoding failed');
  const geoJson = await geocoding.json();
  const first = geoJson?.results?.[0];
  if (!first?.latitude || !first?.longitude) {
    throw new Error('Ort nicht gefunden');
  }

  const forecast = await fetch(
    `https://api.open-meteo.com/v1/forecast?latitude=${first.latitude}&longitude=${first.longitude}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`,
  );
  if (!forecast.ok) throw new Error('Forecast failed');
  const fcJson = await forecast.json();
  const current = fcJson?.current;

  return {
    city: String(first.name),
    tempC: Number(current?.temperature_2m ?? 0),
    wind: Number(current?.wind_speed_10m ?? 0),
    code: Number(current?.weather_code ?? 0),
  };
}

function weatherLabel(code: number): string {
  if (code === 0) return 'Klar';
  if (code <= 3) return 'Bewoelkt';
  if (code === 45 || code === 48) return 'Nebel';
  if (code >= 51 && code <= 67) return 'Niesel/Regen';
  if (code >= 71 && code <= 77) return 'Schnee';
  if (code >= 80 && code <= 99) return 'Schauer/Gewitter';
  return 'Wetter';
}

function WeatherIcon({ code }: { code: number }) {
  if (code === 0) return <Sun size={28} className="text-amber-200" />;
  if (code <= 3) return <CloudSun size={28} className="text-sky-200" />;
  if (code === 45 || code === 48) return <CloudFog size={28} className="text-zinc-200" />;
  if (code >= 51 && code <= 67) return <CloudDrizzle size={28} className="text-cyan-200" />;
  if (code >= 71 && code <= 77) return <CloudSnow size={28} className="text-sky-100" />;
  if (code >= 80 && code <= 99) return <CloudRain size={28} className="text-cyan-200" />;
  return <Cloud size={28} className="text-zinc-200" />;
}

function WeatherWidget({ city }: { city: string }) {
  const query = useQuery({
    queryKey: ['home-widget', 'weather', city],
    queryFn: () => fetchWeather(city),
    staleTime: 1000 * 60 * 20,
    refetchInterval: 1000 * 60 * 30,
  });

  if (query.isLoading) {
    return <p className="text-sm text-zinc-300">Wetter wird geladen...</p>;
  }

  if (query.isError || !query.data) {
    return <p className="text-sm text-zinc-300">Wetterdaten nicht verfuegbar.</p>;
  }

  return (
    <div className="flex h-full items-end justify-between gap-3">
      <div>
        <p className="text-xs text-zinc-300">{query.data.city}</p>
        <p className="text-3xl font-semibold text-zinc-100">{query.data.tempC.toFixed(1)}°C</p>
        <p className="text-xs text-zinc-300">
          {weatherLabel(query.data.code)} · Wind {query.data.wind.toFixed(0)} km/h
        </p>
      </div>
      <WeatherIcon code={query.data.code} />
    </div>
  );
}

function ClockWidget() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const handle = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(handle);
  }, []);

  return (
    <div className="space-y-1">
      <p className="text-4xl font-semibold text-zinc-100">
        {now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </p>
      <p className="text-xs text-zinc-300">
        {now.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long' })}
      </p>
    </div>
  );
}

function WelcomeWidget({ title, note, username }: { title: string; note: string; username?: string }) {
  const hour = new Date().getHours();
  const daytime = hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Guten Tag' : 'Guten Abend';

  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-[0.14em] text-cyan-100/80">{daytime}</p>
        <h4 className="mt-1 text-xl font-semibold text-zinc-100">{title}</h4>
        <p className="mt-2 text-sm text-zinc-200">{note}</p>
      </div>
      <p className="text-xs text-zinc-300">Aktiv als {username ?? 'Cloud User'}.</p>
    </div>
  );
}

function NotesWidget({ text }: { text: string }) {
  return <p className="whitespace-pre-wrap text-sm text-zinc-100/95">{text}</p>;
}

function StorageWidget({ bytesUsed, bytesLimit }: { bytesUsed: number; bytesLimit: number }) {
  const unlimited = bytesLimit <= 0;
  const ratio = unlimited ? 0 : clamp((bytesUsed / bytesLimit) * 100, 0, 100);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-xs uppercase tracking-[0.12em] text-zinc-300">Speicher</p>
        <p className="mt-1 text-lg font-semibold text-zinc-100">{formatBytes(bytesUsed)} genutzt</p>
        <p className="text-xs text-zinc-300">{unlimited ? 'Unbegrenztes Kontingent' : `${formatBytes(bytesLimit)} gesamt`}</p>
      </div>

      {unlimited ? (
        <div className="rounded-lg border border-emerald-300/30 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-100">Unlimited</div>
      ) : (
        <>
          <div className="h-2 overflow-hidden rounded-full bg-white/15">
            <div className="h-full rounded-full bg-cyan-300/80 transition-all" style={{ width: `${ratio}%` }} />
          </div>
          <p className="text-xs text-zinc-300">{ratio.toFixed(1)}% belegt</p>
        </>
      )}
    </div>
  );
}

function ShortcutsWidget() {
  const navigate = useNavigate();
  const { data: user } = useCurrentUser();

  const canReadFiles = hasPermission(user, PERMISSIONS.FILE_READ);
  const canMedia = canReadFiles && hasPermission(user, PERMISSIONS.MEDIA_VIEW);

  return (
    <div className="grid h-full gap-2 sm:grid-cols-2">
      {canReadFiles ? (
        <Button variant="secondary" size="sm" className="justify-start" onClick={() => navigate('/app/files')}>
          <Upload size={13} className="mr-1" /> Dateien
        </Button>
      ) : null}

      {canReadFiles ? (
        <Button variant="secondary" size="sm" className="justify-start" onClick={() => navigate('/app/search')}>
          <Search size={13} className="mr-1" /> Suche
        </Button>
      ) : null}

      {canReadFiles ? (
        <Button variant="secondary" size="sm" className="justify-start" onClick={() => navigate('/app/recents')}>
          <FolderClock size={13} className="mr-1" /> Recents
        </Button>
      ) : null}

      {canMedia ? (
        <Button variant="secondary" size="sm" className="justify-start" onClick={() => navigate('/app/media')}>
          <ImageIcon size={13} className="mr-1" /> Media
        </Button>
      ) : null}

      <Button variant="secondary" size="sm" className="justify-start" onClick={() => navigate('/app/settings')}>
        <Settings size={13} className="mr-1" /> Einstellungen
      </Button>

      <Button variant="secondary" size="sm" className="justify-start" onClick={() => navigate('/app/home')}>
        <Link2 size={13} className="mr-1" /> Home
      </Button>
    </div>
  );
}

function RecentsWidget({ limit, canReadFiles }: { limit: number; canReadFiles: boolean }) {
  const navigate = useNavigate();
  const query = useQuery({
    queryKey: ['home-widget', 'recents', limit],
    queryFn: () => api.files.recents(limit),
    enabled: canReadFiles,
    staleTime: 1000 * 60 * 3,
  });

  if (!canReadFiles) {
    return <p className="text-sm text-zinc-300">Keine Berechtigung fuer Dateiansicht.</p>;
  }

  if (query.isLoading) {
    return <p className="text-sm text-zinc-300">Recents werden geladen...</p>;
  }

  if (query.isError) {
    return <p className="text-sm text-zinc-300">{toApiMessage(query.error)}</p>;
  }

  const items = query.data ?? [];

  if (items.length === 0) {
    return <p className="text-sm text-zinc-300">Noch keine Dateien vorhanden.</p>;
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5">
            <p className="truncate text-xs font-medium text-zinc-100">{item.name}</p>
            <p className="text-[11px] text-zinc-300">
              {formatBytes(item.size)} · {formatDate(item.updated_at)}
            </p>
          </div>
        ))}
      </div>
      <Button variant="secondary" size="sm" className="justify-start" onClick={() => navigate('/app/recents')}>
        <FolderClock size={13} className="mr-1" /> Alle Recents
      </Button>
    </div>
  );
}

function WidgetShell({
  title,
  subtitle,
  onRemove,
  onEdit,
  onDragStart,
  dragEnabled,
  dragging,
  style,
  children,
}: {
  title: string;
  subtitle?: string;
  onRemove: () => void;
  onEdit: () => void;
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  dragEnabled: boolean;
  dragging: boolean;
  style: CSSProperties;
  children: JSX.Element;
}) {
  return (
    <article
      style={style}
      className={cn(
        'absolute overflow-hidden rounded-2xl border border-white/20 bg-black/35 p-3 text-left shadow-[0_16px_50px_rgba(0,0,0,0.35)] transition-transform',
        dragging ? 'scale-[1.01] border-cyan-300/50 shadow-[0_20px_60px_rgba(34,211,238,0.2)]' : '',
      )}
    >
      <header className="mb-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-zinc-100">{title}</h3>
          {subtitle ? <p className="truncate text-xs text-zinc-300">{subtitle}</p> : null}
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onPointerDown={onDragStart}
            disabled={!dragEnabled}
            className={cn(
              'rounded-md border px-2 py-1 text-[11px] text-zinc-200',
              dragEnabled
                ? 'cursor-grab border-cyan-300/30 bg-cyan-400/10 hover:bg-cyan-400/20'
                : 'cursor-not-allowed border-white/10 bg-black/20 opacity-50',
            )}
            title={dragEnabled ? 'Widget ziehen' : 'Layout ist gesperrt'}
            aria-label="Widget ziehen"
          >
            <GripVertical size={12} />
          </button>

          <button
            type="button"
            onClick={onEdit}
            className="rounded-md border border-white/10 bg-black/25 px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10"
          >
            Edit
          </button>

          <button
            type="button"
            onClick={onRemove}
            className="rounded-md border border-rose-300/20 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-100 hover:bg-rose-500/20"
            aria-label="Widget entfernen"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </header>

      <div className="h-[calc(100%-38px)]">{children}</div>
    </article>
  );
}

export function HomePage() {
  const { data: user } = useCurrentUser();
  const canReadFiles = hasPermission(user, PERMISSIONS.FILE_READ);

  const [layout, setLayout] = useState<HomeLayoutState>(() => loadLayoutState());
  const widgets = layout.widgets;
  const prefs = layout.prefs;

  const setWidgets = useCallback((updater: WidgetUpdater) => {
    setLayout((prev) => {
      const nextWidgets = typeof updater === 'function' ? updater(prev.widgets) : updater;
      return { ...prev, widgets: nextWidgets };
    });
  }, []);

  const patchPrefs = useCallback((patch: Partial<HomePrefs>) => {
    setLayout((prev) => ({
      ...prev,
      prefs: {
        ...prev.prefs,
        ...patch,
      },
    }));
  }, []);

  const [layoutUnlocked, setLayoutUnlocked] = useState(true);
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [draftType, setDraftType] = useState<WidgetType>('weather');
  const [draftSize, setDraftSize] = useState<WidgetSize>('medium');
  const [draftCity, setDraftCity] = useState('Berlin');
  const [draftImageSource, setDraftImageSource] = useState<ImageSourceType>('url');
  const [draftImageUrl, setDraftImageUrl] = useState('');
  const [draftImageCloudId, setDraftImageCloudId] = useState('');
  const [draftCaption, setDraftCaption] = useState('');
  const [draftWelcomeTitle, setDraftWelcomeTitle] = useState('Willkommen zur Home-Ansicht');
  const [draftWelcomeNote, setDraftWelcomeNote] = useState('Hier findest du alles, was du taeglich brauchst.');
  const [draftRecentsLimit, setDraftRecentsLimit] = useState('5');
  const [draftNotesText, setDraftNotesText] = useState('Meine Notiz...');

  const editingWidget = useMemo(() => widgets.find((widget) => widget.id === editingId) ?? null, [editingId, widgets]);

  const boardRef = useRef<HTMLDivElement | null>(null);
  const [boardWidth, setBoardWidth] = useState(1200);

  const dragRef = useRef<DragState | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const assetUrlsRef = useRef<Map<number, string>>(new Map());
  const pendingAssetLoadsRef = useRef<Map<number, Promise<string>>>(new Map());
  const [cloudAssetUrls, setCloudAssetUrls] = useState<Record<number, string>>({});
  const [cloudAssetErrors, setCloudAssetErrors] = useState<Record<number, string>>({});

  const activeDraftCloudId = draftImageSource === 'cloud' ? parsePositiveInt(draftImageCloudId) : null;

  const cloudIdsNeeded = useMemo(() => {
    const ids = new Set<number>();

    for (const widget of widgets) {
      if (widget.type === 'image' && widget.source === 'cloud' && widget.cloud_file_id) {
        ids.add(widget.cloud_file_id);
      }
    }

    if (activeDraftCloudId) {
      ids.add(activeDraftCloudId);
    }

    return [...ids];
  }, [activeDraftCloudId, widgets]);

  const cloudImageQuery = useQuery({
    queryKey: ['home-widget', 'cloud-image-nodes'],
    queryFn: loadCloudImageNodes,
    enabled: editorOpen && draftType === 'image' && draftImageSource === 'cloud' && canReadFiles,
    staleTime: 1000 * 60 * 5,
  });

  const ensureCloudAssetUrl = useCallback(async (fileId: number): Promise<string> => {
    const cached = assetUrlsRef.current.get(fileId);
    if (cached) return cached;

    const pending = pendingAssetLoadsRef.current.get(fileId);
    if (pending) return pending;

    const request = api.files
      .blob(fileId)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        assetUrlsRef.current.set(fileId, url);
        setCloudAssetUrls((prev) => ({ ...prev, [fileId]: url }));

        setCloudAssetErrors((prev) => {
          if (!(fileId in prev)) return prev;
          const next = { ...prev };
          delete next[fileId];
          return next;
        });

        return url;
      })
      .catch((error) => {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          setWidgets((prev) =>
            prev.map((widget) => {
              if (widget.type !== 'image') return widget;
              if (widget.source !== 'cloud') return widget;
              if (widget.cloud_file_id !== fileId) return widget;
              return {
                ...widget,
                cloud_file_id: null,
              };
            }),
          );
        }

        setCloudAssetErrors((prev) => ({
          ...prev,
          [fileId]: toApiMessage(error),
        }));
        throw error;
      })
      .finally(() => {
        pendingAssetLoadsRef.current.delete(fileId);
      });

    pendingAssetLoadsRef.current.set(fileId, request);
    return request;
  }, [setWidgets]);

  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const update = () => {
      setBoardWidth(board.clientWidth);
    };

    update();

    const observer = new ResizeObserver(update);
    observer.observe(board);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (draggingId) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  }, [draggingId, layout]);

  useEffect(() => {
    if (cloudIdsNeeded.length === 0) {
      if (assetUrlsRef.current.size === 0) return;

      for (const url of assetUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }

      assetUrlsRef.current.clear();
      pendingAssetLoadsRef.current.clear();
      setCloudAssetUrls({});
      setCloudAssetErrors({});
      return;
    }

    let cancelled = false;
    const loadAssets = async () => {
      for (const id of cloudIdsNeeded) {
        if (cancelled) return;

        try {
          await ensureCloudAssetUrl(id);
        } catch {
          // individual image errors are tracked per id
        }
      }

      const keep = new Set(cloudIdsNeeded);
      const toDelete: number[] = [];

      for (const id of assetUrlsRef.current.keys()) {
        if (!keep.has(id)) toDelete.push(id);
      }

      if (toDelete.length > 0) {
        setCloudAssetUrls((prev) => {
          const next = { ...prev };
          for (const id of toDelete) {
            const url = assetUrlsRef.current.get(id);
            if (url) URL.revokeObjectURL(url);
            assetUrlsRef.current.delete(id);
            delete next[id];
          }
          return next;
        });

        setCloudAssetErrors((prev) => {
          const next = { ...prev };
          for (const id of toDelete) {
            delete next[id];
          }
          return next;
        });
      }
    };

    void loadAssets();
    return () => {
      cancelled = true;
    };
  }, [cloudIdsNeeded, ensureCloudAssetUrl]);

  useEffect(() => {
    return () => {
      for (const url of assetUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      assetUrlsRef.current.clear();
      pendingAssetLoadsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!draggingId) return;

    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;

      const board = boardRef.current;
      if (!board) return;

      const rect = board.getBoundingClientRect();
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      const candidateX = drag.originX + dx;
      const candidateY = drag.originY + dy;
      const clamped = clampPosition(drag.size, candidateX, candidateY, rect.width, prefs.boardHeight, prefs.snapToGrid);

      setWidgets((prev) =>
        prev.map((widget) => {
          if (widget.id !== drag.widgetId) return widget;
          if (widget.x === clamped.x && widget.y === clamped.y) return widget;
          return {
            ...widget,
            x: clamped.x,
            y: clamped.y,
          };
        }),
      );
    };

    const handleEnd = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      dragRef.current = null;
      setDraggingId(null);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
    };
  }, [draggingId, prefs.boardHeight, prefs.snapToGrid, setWidgets]);

  useEffect(() => {
    if (boardWidth <= 0) return;

    setWidgets((prev) => {
      let changed = false;

      const next = prev.map((widget) => {
        const clamped = clampPosition(widget.size, widget.x, widget.y, boardWidth, prefs.boardHeight, prefs.snapToGrid);
        if (clamped.x === widget.x && clamped.y === widget.y) return widget;

        changed = true;
        return {
          ...widget,
          x: clamped.x,
          y: clamped.y,
        };
      });

      return changed ? next : prev;
    });
  }, [boardWidth, prefs.boardHeight, prefs.snapToGrid, setWidgets]);

  const orderedWidgets = useMemo(() => [...widgets].sort((a, b) => a.layer - b.layer), [widgets]);
  const activeTheme = THEME_STYLES[prefs.theme];

  const setDefaultDraftForType = useCallback((type: WidgetType) => {
    setDraftType(type);
    setDraftSize(type === 'welcome' ? 'large' : type === 'notes' ? 'small' : 'medium');
    setDraftCity('Berlin');
    setDraftImageSource('url');
    setDraftImageUrl('');
    setDraftImageCloudId('');
    setDraftCaption('');
    setDraftWelcomeTitle('Willkommen zur Home-Ansicht');
    setDraftWelcomeNote('Hier findest du alles, was du taeglich brauchst.');
    setDraftRecentsLimit('5');
    setDraftNotesText('Meine Notiz...');
  }, []);

  const openAdd = useCallback(
    (type: WidgetType = 'weather') => {
      setEditingId(null);
      setDefaultDraftForType(type);
      setEditorOpen(true);
    },
    [setDefaultDraftForType],
  );

  const openEdit = useCallback((widget: HomeWidget) => {
    setEditingId(widget.id);
    setDraftType(widget.type);
    setDraftSize(widget.size);

    if (widget.type === 'welcome') {
      setDraftWelcomeTitle(widget.title);
      setDraftWelcomeNote(widget.note);
      setDraftCity('Berlin');
      setDraftImageSource('url');
      setDraftImageUrl('');
      setDraftImageCloudId('');
      setDraftCaption('');
      setDraftRecentsLimit('5');
      setDraftNotesText('Meine Notiz...');
    } else if (widget.type === 'weather') {
      setDraftCity(widget.city);
      setDraftImageSource('url');
      setDraftImageUrl('');
      setDraftImageCloudId('');
      setDraftCaption('');
      setDraftWelcomeTitle('Willkommen zur Home-Ansicht');
      setDraftWelcomeNote('Hier findest du alles, was du taeglich brauchst.');
      setDraftRecentsLimit('5');
      setDraftNotesText('Meine Notiz...');
    } else if (widget.type === 'image') {
      setDraftImageSource(widget.source);
      setDraftImageUrl(widget.image_url);
      setDraftImageCloudId(widget.cloud_file_id ? String(widget.cloud_file_id) : '');
      setDraftCaption(widget.caption);
      setDraftCity('Berlin');
      setDraftWelcomeTitle('Willkommen zur Home-Ansicht');
      setDraftWelcomeNote('Hier findest du alles, was du taeglich brauchst.');
      setDraftRecentsLimit('5');
      setDraftNotesText('Meine Notiz...');
    } else if (widget.type === 'recents') {
      setDraftRecentsLimit(String(widget.limit));
      setDraftCity('Berlin');
      setDraftImageSource('url');
      setDraftImageUrl('');
      setDraftImageCloudId('');
      setDraftCaption('');
      setDraftWelcomeTitle('Willkommen zur Home-Ansicht');
      setDraftWelcomeNote('Hier findest du alles, was du taeglich brauchst.');
      setDraftNotesText('Meine Notiz...');
    } else if (widget.type === 'notes') {
      setDraftNotesText(widget.text);
      setDraftCity('Berlin');
      setDraftImageSource('url');
      setDraftImageUrl('');
      setDraftImageCloudId('');
      setDraftCaption('');
      setDraftWelcomeTitle('Willkommen zur Home-Ansicht');
      setDraftWelcomeNote('Hier findest du alles, was du taeglich brauchst.');
      setDraftRecentsLimit('5');
    } else {
      setDraftCity('Berlin');
      setDraftImageSource('url');
      setDraftImageUrl('');
      setDraftImageCloudId('');
      setDraftCaption('');
      setDraftWelcomeTitle('Willkommen zur Home-Ansicht');
      setDraftWelcomeNote('Hier findest du alles, was du taeglich brauchst.');
      setDraftRecentsLimit('5');
      setDraftNotesText('Meine Notiz...');
    }

    setEditorOpen(true);
  }, []);

  const startDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, widget: HomeWidget) => {
      if (!layoutUnlocked) return;

      const board = boardRef.current;
      if (!board) return;

      event.preventDefault();
      event.stopPropagation();

      const maxLayer = widgets.reduce((max, item) => Math.max(max, item.layer), 0);
      setWidgets((prev) => prev.map((item) => (item.id === widget.id ? { ...item, layer: maxLayer + 1 } : item)));

      dragRef.current = {
        widgetId: widget.id,
        size: widget.size,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: widget.x,
        originY: widget.y,
      };

      setDraggingId(widget.id);
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [layoutUnlocked, setWidgets, widgets],
  );

  const buildWidgetFromDraft = useCallback(
    (id: string, placement: Pick<BaseWidget, 'x' | 'y' | 'layer'>): HomeWidget | null => {
      if (draftType === 'welcome') {
        return {
          id,
          type: 'welcome',
          size: draftSize,
          x: placement.x,
          y: placement.y,
          layer: placement.layer,
          title: draftWelcomeTitle.trim() || 'Willkommen',
          note: draftWelcomeNote.trim() || 'Mach dein Home komplett auf deinen Workflow zugeschnitten.',
        };
      }

      if (draftType === 'weather') {
        const city = draftCity.trim();
        if (city.length < 2) return null;
        return {
          id,
          type: 'weather',
          size: draftSize,
          x: placement.x,
          y: placement.y,
          layer: placement.layer,
          city,
        };
      }

      if (draftType === 'clock') {
        return {
          id,
          type: 'clock',
          size: draftSize,
          x: placement.x,
          y: placement.y,
          layer: placement.layer,
        };
      }

      if (draftType === 'shortcuts') {
        return {
          id,
          type: 'shortcuts',
          size: draftSize,
          x: placement.x,
          y: placement.y,
          layer: placement.layer,
        };
      }

      if (draftType === 'image') {
        if (draftImageSource === 'url') {
          const url = draftImageUrl.trim();
          if (url.length < 8) return null;
          return {
            id,
            type: 'image',
            size: draftSize,
            x: placement.x,
            y: placement.y,
            layer: placement.layer,
            source: 'url',
            image_url: url,
            cloud_file_id: null,
            caption: draftCaption.trim(),
          };
        }

        const cloudId = parsePositiveInt(draftImageCloudId);
        if (!cloudId) return null;

        return {
          id,
          type: 'image',
          size: draftSize,
          x: placement.x,
          y: placement.y,
          layer: placement.layer,
          source: 'cloud',
          image_url: '',
          cloud_file_id: cloudId,
          caption: draftCaption.trim(),
        };
      }

      if (draftType === 'recents') {
        const limit = clamp(parsePositiveInt(draftRecentsLimit) ?? 5, 3, 12);
        return {
          id,
          type: 'recents',
          size: draftSize,
          x: placement.x,
          y: placement.y,
          layer: placement.layer,
          limit,
        };
      }

      if (draftType === 'storage') {
        return {
          id,
          type: 'storage',
          size: draftSize,
          x: placement.x,
          y: placement.y,
          layer: placement.layer,
        };
      }

      return {
        id,
        type: 'notes',
        size: draftSize,
        x: placement.x,
        y: placement.y,
        layer: placement.layer,
        text: draftNotesText.trim() || 'Meine Notiz...',
      };
    },
    [
      draftCaption,
      draftCity,
      draftImageCloudId,
      draftImageSource,
      draftImageUrl,
      draftNotesText,
      draftRecentsLimit,
      draftSize,
      draftType,
      draftWelcomeNote,
      draftWelcomeTitle,
    ],
  );

  const saveDraft = () => {
    if (editingWidget) {
      const next = buildWidgetFromDraft(editingWidget.id, {
        x: editingWidget.x,
        y: editingWidget.y,
        layer: editingWidget.layer,
      });
      if (!next) return;

      setWidgets((prev) => prev.map((widget) => (widget.id === editingWidget.id ? next : widget)));
      setEditorOpen(false);
      return;
    }

    const maxLayer = widgets.reduce((max, item) => Math.max(max, item.layer), 0);
    const placement = suggestPlacement(widgets, draftSize, boardWidth, prefs.boardHeight, maxLayer + 1);
    const next = buildWidgetFromDraft(createId(), placement);
    if (!next) return;

    setWidgets((prev) => [...prev, next]);
    setEditorOpen(false);
  };

  const removeWidget = useCallback(
    (id: string) => {
      setWidgets((prev) => prev.filter((widget) => widget.id !== id));
      if (editingId === id) {
        setEditingId(null);
        setEditorOpen(false);
      }
    },
    [editingId, setWidgets],
  );

  const autoArrange = () => {
    setWidgets((prev) => {
      const ordered = [...prev].sort((a, b) => a.layer - b.layer);
      return ordered.map((widget, index) => {
        const placement = defaultPlacement(index, widget.size);
        const clamped = clampPosition(widget.size, placement.x, placement.y, boardWidth, prefs.boardHeight, false);
        return {
          ...widget,
          x: clamped.x,
          y: clamped.y,
          layer: index + 1,
        };
      });
    });
  };

  const resetHome = () => {
    const confirmed = window.confirm('Moechtest du Home auf das Starter-Layout zuruecksetzen?');
    if (!confirmed) return;
    setLayout({
      widgets: buildStarterWidgets(),
      prefs: DEFAULT_PREFS,
    });
    setEditorOpen(false);
    setEditingId(null);
  };

  const widgetCount = widgets.length;

  const renderWidgetContent = (widget: HomeWidget): JSX.Element => {
    if (widget.type === 'welcome') {
      return <WelcomeWidget title={widget.title} note={widget.note} username={user?.username} />;
    }

    if (widget.type === 'weather') {
      return <WeatherWidget city={widget.city} />;
    }

    if (widget.type === 'clock') {
      return <ClockWidget />;
    }

    if (widget.type === 'shortcuts') {
      return <ShortcutsWidget />;
    }

    if (widget.type === 'image') {
      if (widget.source === 'url') {
        if (!widget.image_url) {
          return (
            <div className="flex h-full items-center justify-center rounded-xl border border-white/10 bg-black/30 text-sm text-zinc-300">
              Bild-URL fehlt
            </div>
          );
        }

        return (
          <div className="relative h-full overflow-hidden rounded-xl border border-white/10 bg-black/30">
            <img src={widget.image_url} alt={widget.caption || 'Widget image'} className="h-full w-full object-cover" />
            {widget.caption ? (
              <div className="absolute inset-x-0 bottom-0 bg-black/45 px-2 py-1 text-xs text-zinc-100">{widget.caption}</div>
            ) : null}
          </div>
        );
      }

      if (!widget.cloud_file_id) {
        return (
          <div className="flex h-full items-center justify-center rounded-xl border border-white/10 bg-black/30 text-sm text-zinc-300">
            Cloud-ID fehlt
          </div>
        );
      }

      const cloudUrl = cloudAssetUrls[widget.cloud_file_id];
      const cloudError = cloudAssetErrors[widget.cloud_file_id];

      if (cloudError) {
        return (
          <div className="flex h-full items-center justify-center rounded-xl border border-rose-300/30 bg-rose-500/10 px-3 text-center text-sm text-rose-100">
            Cloud-Bild #{widget.cloud_file_id} konnte nicht geladen werden.
          </div>
        );
      }

      if (!cloudUrl) {
        return (
          <div className="flex h-full items-center justify-center rounded-xl border border-white/10 bg-black/30 text-sm text-zinc-300">
            Cloud-Bild #{widget.cloud_file_id} wird geladen...
          </div>
        );
      }

      return (
        <div className="relative h-full overflow-hidden rounded-xl border border-white/10 bg-black/30">
          <img src={cloudUrl} alt={widget.caption || `Cloud image ${widget.cloud_file_id}`} className="h-full w-full object-cover" />
          <div className="absolute left-2 top-2 rounded-full border border-black/25 bg-black/55 px-2 py-0.5 text-[10px] text-zinc-100">
            Cloud #{widget.cloud_file_id}
          </div>
          {widget.caption ? (
            <div className="absolute inset-x-0 bottom-0 bg-black/45 px-2 py-1 text-xs text-zinc-100">{widget.caption}</div>
          ) : null}
        </div>
      );
    }

    if (widget.type === 'recents') {
      return <RecentsWidget limit={widget.limit} canReadFiles={canReadFiles} />;
    }

    if (widget.type === 'storage') {
      return <StorageWidget bytesUsed={user?.bytes_used ?? 0} bytesLimit={user?.bytes_limit ?? 0} />;
    }

    return <NotesWidget text={widget.text} />;
  };

  const canSaveDraft = useMemo(() => {
    if (draftType === 'weather') {
      return draftCity.trim().length >= 2;
    }

    if (draftType === 'image') {
      if (draftImageSource === 'url') return draftImageUrl.trim().length >= 8;
      return parsePositiveInt(draftImageCloudId) !== null;
    }

    return true;
  }, [draftCity, draftImageCloudId, draftImageSource, draftImageUrl, draftType]);

  const cloudPreviewUrl = activeDraftCloudId ? cloudAssetUrls[activeDraftCloudId] : '';
  const cloudPreviewError = activeDraftCloudId ? cloudAssetErrors[activeDraftCloudId] : '';

  return (
    <div className="h-full overflow-auto">
      <div className={cn('mx-auto min-h-full w-full max-w-[1280px] p-4 sm:p-6', `bg-gradient-to-b ${activeTheme.shellGradient}`)}>
        <header className="rounded-3xl border border-white/15 bg-black/25 p-4 backdrop-blur-lg sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs', activeTheme.accentClass)}>
                <Sparkles size={12} />
                Home
              </p>
              <h1 className="mt-2 text-2xl font-semibold text-zinc-100 sm:text-3xl">Ein ruhiger Startpunkt</h1>
              <p className="mt-1 text-sm text-zinc-300">
                Dein Platz zum Ankommen. Widgets bleiben frei verschiebbar, aber die Ansicht ist bewusst reduziert.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" onClick={() => setCustomizeOpen((prev) => !prev)}>
                <Palette size={14} className="mr-1" /> {customizeOpen ? 'Weniger anzeigen' : 'Anpassen'}
              </Button>
              <Button variant={layoutUnlocked ? 'default' : 'secondary'} onClick={() => setLayoutUnlocked((prev) => !prev)}>
                <Move size={14} className="mr-1" /> {layoutUnlocked ? 'Ziehen aktiv' : 'Ziehen aus'}
              </Button>
              <Button onClick={() => openAdd()}>
                <Plus size={14} className="mr-1" /> Widget
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
            <span className="rounded-full border border-white/15 bg-black/20 px-2 py-1">{widgetCount} Widgets</span>
            <span className="rounded-full border border-white/15 bg-black/20 px-2 py-1">{activeTheme.name}</span>
            <span className="rounded-full border border-white/15 bg-black/20 px-2 py-1">Snap {prefs.snapToGrid ? 'Ein' : 'Aus'}</span>
          </div>
        </header>

        {customizeOpen ? (
          <section className="mt-3 rounded-2xl border border-white/15 bg-black/20 p-4 backdrop-blur-lg">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-xs uppercase tracking-[0.12em] text-zinc-300">Widgets hinzufuegen</p>
                <div className="flex flex-wrap gap-2">
                  {WIDGET_LIBRARY.map((entry) => {
                    const disabled = Boolean(entry.requiresFileRead && !canReadFiles);
                    return (
                      <button
                        key={entry.type}
                        type="button"
                        disabled={disabled}
                        onClick={() => openAdd(entry.type)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs',
                          disabled
                            ? 'cursor-not-allowed border-white/10 bg-black/20 text-zinc-500'
                            : 'border-white/15 bg-black/25 text-zinc-100 hover:bg-white/10',
                        )}
                      >
                        {entry.icon}
                        {entry.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <p className="mb-2 text-xs uppercase tracking-[0.12em] text-zinc-300">Theme</p>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(THEME_STYLES) as HomeTheme[]).map((theme) => {
                      const selected = prefs.theme === theme;
                      return (
                        <button
                          key={theme}
                          type="button"
                          onClick={() => patchPrefs({ theme })}
                          className={cn(
                            'rounded-full border px-3 py-1.5 text-xs',
                            selected
                              ? 'border-cyan-300/45 bg-cyan-500/15 text-cyan-100'
                              : 'border-white/10 bg-black/20 text-zinc-200 hover:bg-white/10',
                          )}
                        >
                          {THEME_STYLES[theme].name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-zinc-300">
                      <span>Board-Hoehe</span>
                      <span>{prefs.boardHeight}px</span>
                    </div>
                    <input
                      type="range"
                      min={620}
                      max={1400}
                      step={20}
                      value={prefs.boardHeight}
                      onChange={(event) => patchPrefs({ boardHeight: clamp(Number(event.target.value), 620, 1400) })}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between text-xs text-zinc-300">
                      <span>Glas-Unschaerfe</span>
                      <span>{prefs.cardBlur}px</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={28}
                      step={1}
                      value={prefs.cardBlur}
                      onChange={(event) => patchPrefs({ cardBlur: clamp(Number(event.target.value), 0, 28) })}
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => patchPrefs({ showGrid: !prefs.showGrid })}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs',
                      prefs.showGrid
                        ? 'border-cyan-300/45 bg-cyan-500/15 text-cyan-100'
                        : 'border-white/10 bg-black/20 text-zinc-200',
                    )}
                  >
                    Grid {prefs.showGrid ? 'Ein' : 'Aus'}
                  </button>
                  <button
                    type="button"
                    onClick={() => patchPrefs({ snapToGrid: !prefs.snapToGrid })}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs',
                      prefs.snapToGrid
                        ? 'border-cyan-300/45 bg-cyan-500/15 text-cyan-100'
                        : 'border-white/10 bg-black/20 text-zinc-200',
                    )}
                  >
                    Snap {prefs.snapToGrid ? 'Ein' : 'Aus'}
                  </button>
                  <Button variant="secondary" size="sm" onClick={autoArrange}>
                    Auto-Arrange
                  </Button>
                  <Button variant="secondary" size="sm" onClick={resetHome}>
                    Reset
                  </Button>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="mt-4 rounded-3xl border border-white/15 bg-black/20 p-3 backdrop-blur-lg sm:p-4">
          <div
            ref={boardRef}
            className={cn('relative w-full overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br', activeTheme.boardGradient)}
            style={{ height: prefs.boardHeight }}
          >
            <div className="pointer-events-none absolute inset-0">
              {prefs.showGrid ? (
                <div
                  className="absolute inset-0 opacity-20"
                  style={{
                    backgroundImage:
                      'linear-gradient(to right, rgba(255,255,255,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.12) 1px, transparent 1px)',
                    backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
                  }}
                />
              ) : null}

              <div
                className={cn(
                  'absolute left-[18%] top-[-90px] h-[220px] w-[220px] rounded-full blur-3xl',
                  `bg-gradient-to-br ${activeTheme.glowClass}`,
                )}
              />
            </div>

            {orderedWidgets.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
                <div className="max-w-md rounded-2xl border border-white/15 bg-black/25 p-6">
                  <h3 className="text-lg font-semibold text-zinc-100">Noch leer</h3>
                  <p className="mt-1 text-sm text-zinc-300">Fuege dein erstes Widget hinzu und ziehe es an den Platz, der sich gut anfuehlt.</p>
                  <div className="mt-4">
                    <Button onClick={() => openAdd()}>
                      <Plus size={14} className="mr-1" /> Widget hinzufuegen
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {orderedWidgets.map((widget) => {
              const dimensions = getWidgetDimensions(widget.size, boardWidth);
              const style: CSSProperties = {
                width: dimensions.width,
                height: dimensions.height,
                transform: `translate(${widget.x}px, ${widget.y}px)`,
                zIndex: draggingId === widget.id ? 3000 : widget.layer,
                backdropFilter: `blur(${prefs.cardBlur}px)`,
                WebkitBackdropFilter: `blur(${prefs.cardBlur}px)`,
              };

              const subtitle =
                widget.type === 'weather'
                  ? widget.city
                  : widget.type === 'image'
                    ? widget.source === 'cloud'
                      ? widget.cloud_file_id
                        ? `Cloud-ID ${widget.cloud_file_id}`
                        : 'Cloud'
                      : 'URL'
                    : widget.type === 'recents'
                      ? `${widget.limit} Eintraege`
                      : undefined;

              return (
                <WidgetShell
                  key={widget.id}
                  title={widgetTypeLabel(widget.type)}
                  subtitle={subtitle}
                  onEdit={() => openEdit(widget)}
                  onRemove={() => removeWidget(widget.id)}
                  onDragStart={(event) => startDrag(event, widget)}
                  dragEnabled={layoutUnlocked}
                  dragging={draggingId === widget.id}
                  style={style}
                >
                  {renderWidgetContent(widget)}
                </WidgetShell>
              );
            })}
          </div>
        </section>
      </div>

      {editorOpen ? (
        <div className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm" onClick={() => setEditorOpen(false)}>
          <div
            className="absolute left-1/2 top-1/2 w-[min(95vw,620px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/15 bg-[#070d24f2] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-zinc-100">{editingWidget ? 'Widget bearbeiten' : 'Widget hinzufuegen'}</h3>

            {!editingWidget ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {WIDGET_LIBRARY.map((entry) => {
                  const disabled = Boolean(entry.requiresFileRead && !canReadFiles);
                  return (
                    <button
                      key={entry.type}
                      type="button"
                      disabled={disabled}
                      onClick={() => setDefaultDraftForType(entry.type)}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-left text-sm',
                        disabled
                          ? 'cursor-not-allowed border-white/10 bg-black/20 text-zinc-500'
                          : draftType === entry.type
                            ? 'border-cyan-300/45 bg-cyan-500/15 text-cyan-100'
                            : 'border-white/10 bg-black/25 text-zinc-200 hover:bg-white/10',
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {entry.icon}
                        {entry.label}
                      </span>
                      <p className="mt-1 text-xs text-zinc-300">{entry.description}</p>
                    </button>
                  );
                })}
              </div>
            ) : null}

            <div className="mt-3 space-y-3">
              <div>
                <label className="mb-1 block text-xs text-zinc-300">Groesse</label>
                <select
                  value={draftSize}
                  onChange={(event) => setDraftSize(event.target.value as WidgetSize)}
                  className="w-full rounded-xl border border-white/15 bg-black/30 px-2 py-2 text-sm"
                >
                  <option value="small">Klein</option>
                  <option value="medium">Mittel</option>
                  <option value="large">Gross</option>
                </select>
                <p className="mt-1 text-[11px] text-zinc-400">Aktuell: {sizeLabel(draftSize)}</p>
              </div>

              {draftType === 'welcome' ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-300">Titel</label>
                    <Input value={draftWelcomeTitle} onChange={(event) => setDraftWelcomeTitle(event.target.value)} />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-300">Text</label>
                    <textarea
                      value={draftWelcomeNote}
                      onChange={(event) => setDraftWelcomeNote(event.target.value)}
                      rows={3}
                      className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    />
                  </div>
                </>
              ) : null}

              {draftType === 'weather' ? (
                <div>
                  <label className="mb-1 block text-xs text-zinc-300">Ort</label>
                  <Input value={draftCity} onChange={(event) => setDraftCity(event.target.value)} placeholder="z.B. Berlin" />
                </div>
              ) : null}

              {draftType === 'image' ? (
                <>
                  <div>
                    <label className="mb-1 block text-xs text-zinc-300">Bildquelle</label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setDraftImageSource('url')}
                        className={cn(
                          'rounded-lg border px-2.5 py-2 text-xs',
                          draftImageSource === 'url'
                            ? 'border-cyan-300/45 bg-cyan-500/15 text-cyan-100'
                            : 'border-white/10 bg-black/20 text-zinc-200',
                        )}
                      >
                        URL
                      </button>
                      <button
                        type="button"
                        onClick={() => setDraftImageSource('cloud')}
                        disabled={!canReadFiles}
                        className={cn(
                          'rounded-lg border px-2.5 py-2 text-xs',
                          !canReadFiles
                            ? 'cursor-not-allowed border-white/10 bg-black/20 text-zinc-500'
                            : draftImageSource === 'cloud'
                              ? 'border-cyan-300/45 bg-cyan-500/15 text-cyan-100'
                              : 'border-white/10 bg-black/20 text-zinc-200',
                        )}
                      >
                        Cloud-ID
                      </button>
                    </div>
                  </div>

                  {draftImageSource === 'url' ? (
                    <div>
                      <label className="mb-1 block text-xs text-zinc-300">Bild-URL</label>
                      <Input
                        value={draftImageUrl}
                        onChange={(event) => setDraftImageUrl(event.target.value)}
                        placeholder="https://..."
                      />
                    </div>
                  ) : (
                    <>
                      <div>
                        <label className="mb-1 block text-xs text-zinc-300">Cloud-Datei-ID</label>
                        <Input
                          value={draftImageCloudId}
                          onChange={(event) => setDraftImageCloudId(event.target.value)}
                          placeholder="z.B. 128"
                        />
                      </div>

                      {canReadFiles ? (
                        <div>
                          <label className="mb-1 block text-xs text-zinc-300">Oder Bild aus Cloud waehlen</label>
                          <select
                            value={draftImageCloudId}
                            onChange={(event) => setDraftImageCloudId(event.target.value)}
                            className="w-full rounded-xl border border-white/15 bg-black/30 px-2 py-2 text-sm"
                          >
                            <option value="">Bitte waehlen...</option>
                            {(cloudImageQuery.data ?? []).slice(0, 300).map((node) => (
                              <option key={node.id} value={node.id}>
                                #{node.id} · {node.name}
                              </option>
                            ))}
                          </select>

                          {cloudImageQuery.isLoading ? (
                            <p className="mt-1 text-xs text-zinc-400">Cloud-Bilder werden geladen...</p>
                          ) : null}

                          {cloudImageQuery.isError ? (
                            <p className="mt-1 text-xs text-rose-200">{toApiMessage(cloudImageQuery.error)}</p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs text-zinc-400">Keine Datei-Berechtigung fuer Cloud-Auswahl.</p>
                      )}

                      {activeDraftCloudId ? (
                        <div className="rounded-xl border border-white/10 bg-black/20 p-2">
                          <p className="mb-1 text-xs text-zinc-300">Vorschau fuer Cloud-ID #{activeDraftCloudId}</p>
                          {cloudPreviewError ? (
                            <p className="text-xs text-rose-200">{cloudPreviewError}</p>
                          ) : cloudPreviewUrl ? (
                            <img src={cloudPreviewUrl} alt={`Cloud ${activeDraftCloudId}`} className="h-32 w-full rounded-lg object-cover" />
                          ) : (
                            <p className="text-xs text-zinc-400">Vorschau wird geladen...</p>
                          )}
                        </div>
                      ) : null}
                    </>
                  )}

                  <div>
                    <label className="mb-1 block text-xs text-zinc-300">Beschriftung (optional)</label>
                    <Input
                      value={draftCaption}
                      onChange={(event) => setDraftCaption(event.target.value)}
                      placeholder="Titel oder Notiz"
                    />
                  </div>
                </>
              ) : null}

              {draftType === 'recents' ? (
                <div>
                  <label className="mb-1 block text-xs text-zinc-300">Anzahl Eintraege (3-12)</label>
                  <Input value={draftRecentsLimit} onChange={(event) => setDraftRecentsLimit(event.target.value)} />
                </div>
              ) : null}

              {draftType === 'notes' ? (
                <div>
                  <label className="mb-1 block text-xs text-zinc-300">Notiztext</label>
                  <textarea
                    value={draftNotesText}
                    onChange={(event) => setDraftNotesText(event.target.value)}
                    rows={5}
                    className="w-full rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  />
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setEditorOpen(false)}>
                Abbrechen
              </Button>
              <Button onClick={saveDraft} disabled={!canSaveDraft}>
                Speichern
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
