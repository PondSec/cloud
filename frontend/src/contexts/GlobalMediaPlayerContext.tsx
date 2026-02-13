import {
  GripVertical,
  Maximize2,
  Minimize2,
  Music4,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  X,
} from 'lucide-react';
import { motion } from 'motion/react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';

import ElasticSlider from '@/components/reactbits/ElasticSlider';
import { api } from '@/lib/api';
import type { FileNode } from '@/types/api';

interface GlobalMediaPlayerContextValue {
  queue: FileNode[];
  currentTrack: FileNode | null;
  currentIndex: number;
  isPlaying: boolean;
  isLoading: boolean;
  currentTime: number;
  duration: number;
  playTrack: (track: FileNode, queue?: FileNode[]) => void;
  togglePlayPause: () => void;
  playNext: () => void;
  playPrev: () => void;
  seekTo: (seconds: number) => void;
  setVolume: (value: number) => void;
  volume: number;
  stop: () => void;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

const GlobalMediaPlayerContext = createContext<GlobalMediaPlayerContextValue | null>(null);
const HOVER_OPEN_DELAY_MS = 380;
const HOVER_CLOSE_DELAY_MS = 240;
const COMPACT_PLAYER_SIZE = 56;
const EXPANDED_PLAYER_HEIGHT = 170;
const MAX_EXPANDED_PLAYER_WIDTH = 680;

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, '0')}`;
}

export function GlobalMediaPlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const trackUrlCacheRef = useRef<Map<number, string>>(new Map());
  const shouldAutoplayRef = useRef(false);
  const positionInitializedRef = useRef(false);
  const hoverOpenTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);
  const isHoveringRef = useRef(false);

  const [queue, setQueue] = useState<FileNode[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.9);
  const [compactMode, setCompactMode] = useState(false);
  const [hoverExpanded, setHoverExpanded] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 24, y: 24 });

  const currentTrack = currentIndex >= 0 && currentIndex < queue.length ? (queue[currentIndex] ?? null) : null;
  const isExpanded = !compactMode || hoverExpanded;
  const isCompactVisible = compactMode && !isExpanded;

  const getExpandedWidth = useCallback(() => {
    if (typeof window === 'undefined') return MAX_EXPANDED_PLAYER_WIDTH;
    return Math.min(window.innerWidth * 0.92, MAX_EXPANDED_PLAYER_WIDTH);
  }, []);

  const clampPosition = useCallback(
    (x: number, y: number) => {
      if (typeof window === 'undefined') return { x, y };

      const fallbackWidth = compactMode && !hoverExpanded ? COMPACT_PLAYER_SIZE : getExpandedWidth();
      const fallbackHeight = compactMode && !hoverExpanded ? COMPACT_PLAYER_SIZE : EXPANDED_PLAYER_HEIGHT;
      const width = playerRef.current?.offsetWidth ?? fallbackWidth;
      const height = playerRef.current?.offsetHeight ?? fallbackHeight;

      const padding = 10;
      const maxX = Math.max(padding, window.innerWidth - width - padding);
      const maxY = Math.max(padding, window.innerHeight - height - padding);

      return {
        x: Math.min(Math.max(x, padding), maxX),
        y: Math.min(Math.max(y, padding), maxY),
      };
    },
    [compactMode, getExpandedWidth, hoverExpanded],
  );

  const playNext = useCallback(() => {
    if (!queue.length) return;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) return;
    shouldAutoplayRef.current = true;
    setCurrentIndex(nextIndex);
  }, [currentIndex, queue.length]);

  const playPrev = useCallback(() => {
    if (!queue.length) return;
    const prevIndex = currentIndex - 1;
    if (prevIndex < 0) return;
    shouldAutoplayRef.current = true;
    setCurrentIndex(prevIndex);
  }, [currentIndex, queue.length]);

  const stop = useCallback(() => {
    shouldAutoplayRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setCurrentIndex(-1);
  }, []);

  const playTrack = useCallback(
    (track: FileNode, nextQueue?: FileNode[]) => {
      const useQueue = nextQueue && nextQueue.length ? nextQueue : queue.length ? queue : [track];
      const nextIndex = useQueue.findIndex((item) => item.id === track.id);
      shouldAutoplayRef.current = true;
      setQueue(useQueue);
      setCurrentIndex(nextIndex >= 0 ? nextIndex : 0);
    },
    [queue],
  );

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      return;
    }

    if (!currentTrack && queue.length > 0) {
      shouldAutoplayRef.current = true;
      setCurrentIndex(0);
      return;
    }

    shouldAutoplayRef.current = true;
    void audio.play();
  }, [currentTrack, isPlaying, queue.length]);

  const seekTo = useCallback(
    (seconds: number) => {
      const audio = audioRef.current;
      if (!audio) return;
      audio.currentTime = Math.max(0, Math.min(seconds, Number.isFinite(duration) ? duration : seconds));
    },
    [duration],
  );

  const setVolume = useCallback((value: number) => {
    const clamped = Math.max(0, Math.min(1, value));
    setVolumeState(clamped);
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
  }, []);

  const clearHoverTimers = useCallback(() => {
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
  }, []);

  const startDrag = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      clearHoverTimers();
      isHoveringRef.current = false;
      setHoverExpanded(false);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: position.x,
        originY: position.y,
      };
      setIsDragging(true);
    },
    [clearHoverTimers, position.x, position.y],
  );

  const scheduleHoverOpen = useCallback(() => {
    if (!compactMode || isDragging || hoverExpanded || hoverOpenTimerRef.current !== null) return;
    hoverOpenTimerRef.current = window.setTimeout(() => {
      hoverOpenTimerRef.current = null;
      if (!isHoveringRef.current || isDragging || !compactMode) return;
      setHoverExpanded(true);
    }, HOVER_OPEN_DELAY_MS);
  }, [compactMode, hoverExpanded, isDragging]);

  const scheduleHoverClose = useCallback(() => {
    if (!compactMode || isDragging || hoverCloseTimerRef.current !== null) return;
    hoverCloseTimerRef.current = window.setTimeout(() => {
      hoverCloseTimerRef.current = null;
      if (isHoveringRef.current || isDragging || !compactMode) return;
      setHoverExpanded(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [compactMode, isDragging]);

  const handlePlayerPointerEnter = useCallback(() => {
    isHoveringRef.current = true;
    if (hoverCloseTimerRef.current !== null) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    scheduleHoverOpen();
  }, [scheduleHoverOpen]);

  const handlePlayerPointerLeave = useCallback(() => {
    isHoveringRef.current = false;
    if (hoverOpenTimerRef.current !== null) {
      window.clearTimeout(hoverOpenTimerRef.current);
      hoverOpenTimerRef.current = null;
    }
    scheduleHoverClose();
  }, [scheduleHoverClose]);

  useEffect(() => {
    if (!isDragging) return;

    const onMove = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setPosition(clampPosition(drag.originX + dx, drag.originY + dy));
    };

    const onEnd = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      dragRef.current = null;
      setIsDragging(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, [clampPosition, isDragging]);

  useEffect(() => {
    if (!compactMode) {
      clearHoverTimers();
      isHoveringRef.current = false;
      setHoverExpanded(false);
    }
  }, [clearHoverTimers, compactMode]);

  useEffect(() => {
    if (!isDragging) {
      scheduleHoverClose();
    }
  }, [isDragging, scheduleHoverClose]);

  useEffect(() => {
    if (compactMode && isHoveringRef.current && !isDragging) {
      scheduleHoverOpen();
    }
  }, [compactMode, isDragging, scheduleHoverOpen]);

  useEffect(() => {
    return () => {
      clearHoverTimers();
    };
  }, [clearHoverTimers]);

  useEffect(() => {
    if (!currentTrack || positionInitializedRef.current || typeof window === 'undefined') return;
    positionInitializedRef.current = true;

    const initialWidth = compactMode ? COMPACT_PLAYER_SIZE : getExpandedWidth();
    const initialHeight = compactMode ? COMPACT_PLAYER_SIZE : EXPANDED_PLAYER_HEIGHT;
    const next = clampPosition(window.innerWidth - initialWidth - 20, window.innerHeight - initialHeight - 20);
    setPosition(next);
  }, [clampPosition, compactMode, currentTrack, getExpandedWidth]);

  useEffect(() => {
    if (!currentTrack || typeof window === 'undefined') return;
    const frame = window.requestAnimationFrame(() => {
      setPosition((prev) => clampPosition(prev.x, prev.y));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [clampPosition, currentTrack, isExpanded]);

  useEffect(() => {
    const onResize = () => {
      setPosition((prev) => clampPosition(prev.x, prev.y));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampPosition]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onLoadedMeta = () => setDuration(audio.duration || 0);
    const onWaiting = () => setIsLoading(true);
    const onCanPlay = () => setIsLoading(false);
    const onEnded = () => {
      if (currentIndex + 1 < queue.length) {
        shouldAutoplayRef.current = true;
        setCurrentIndex((value) => value + 1);
      } else {
        setIsPlaying(false);
      }
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMeta);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('canplay', onCanPlay);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMeta);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('canplay', onCanPlay);
      audio.removeEventListener('ended', onEnded);
    };
  }, [currentIndex, queue.length]);

  useEffect(() => {
    if (!currentTrack) {
      setCurrentTime(0);
      setDuration(0);
      return;
    }

    let cancelled = false;
    const loadTrack = async () => {
      setIsLoading(true);
      try {
        let url = trackUrlCacheRef.current.get(currentTrack.id);
        if (!url) {
          const blob = await api.files.blob(currentTrack.id);
          if (cancelled) return;
          url = URL.createObjectURL(blob);
          trackUrlCacheRef.current.set(currentTrack.id, url);
        }

        if (cancelled || !url) return;
        const audio = audioRef.current;
        if (!audio) return;
        audio.src = url;
        audio.load();
        if (shouldAutoplayRef.current) {
          try {
            await audio.play();
          } catch {
            // Browser autoplay policy can block play() without user gesture.
          }
        }
      } catch {
        if (!cancelled) {
          setIsPlaying(false);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadTrack();
    return () => {
      cancelled = true;
    };
  }, [currentTrack]);

  useEffect(() => {
    return () => {
      for (const url of trackUrlCacheRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      trackUrlCacheRef.current.clear();
    };
  }, []);

  const value = useMemo<GlobalMediaPlayerContextValue>(
    () => ({
      queue,
      currentTrack,
      currentIndex,
      isPlaying,
      isLoading,
      currentTime,
      duration,
      playTrack,
      togglePlayPause,
      playNext,
      playPrev,
      seekTo,
      setVolume,
      volume,
      stop,
    }),
    [
      currentIndex,
      currentTime,
      currentTrack,
      duration,
      isLoading,
      isPlaying,
      playNext,
      playPrev,
      playTrack,
      queue,
      seekTo,
      setVolume,
      stop,
      togglePlayPause,
      volume,
    ],
  );

  return (
    <GlobalMediaPlayerContext.Provider value={value}>
      {children}
      <audio ref={audioRef} preload="metadata" />
      {currentTrack ? (
        <div
          ref={playerRef}
          className="pointer-events-auto fixed z-[80] select-none"
          style={{ left: `${position.x}px`, top: `${position.y}px` }}
          onPointerEnter={handlePlayerPointerEnter}
          onPointerLeave={handlePlayerPointerLeave}
        >
          <motion.section
            initial={false}
            animate={{
              width: isExpanded ? getExpandedWidth() : COMPACT_PLAYER_SIZE,
              height: isExpanded ? EXPANDED_PLAYER_HEIGHT : COMPACT_PLAYER_SIZE,
              borderRadius: isExpanded ? 16 : 18,
              scale: isDragging ? 1.015 : 1,
            }}
            transition={{
              width: { type: 'spring', stiffness: 430, damping: 34, mass: 0.68 },
              height: { type: 'spring', stiffness: 390, damping: 32, mass: 0.72 },
              borderRadius: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
              scale: { type: 'spring', stiffness: 460, damping: 30, mass: 0.5 },
            }}
            className="relative overflow-hidden border border-white/20 bg-[#091129e8] shadow-2xl backdrop-blur-xl"
          >
            <motion.div
              className="absolute inset-0 z-20 flex items-center justify-center"
              animate={{
                opacity: isCompactVisible ? 1 : 0,
                scale: isCompactVisible ? 1 : 0.84,
                rotate: isCompactVisible ? 0 : -5,
                filter: isCompactVisible ? 'blur(0px)' : 'blur(2px)',
              }}
              transition={{
                opacity: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
                scale: { type: 'spring', stiffness: 500, damping: 35, mass: 0.55 },
                rotate: { type: 'spring', stiffness: 420, damping: 34, mass: 0.6 },
                filter: { duration: 0.18 },
              }}
              style={{ pointerEvents: isCompactVisible ? 'auto' : 'none' }}
            >
              <button
                className="rounded-xl p-2 text-cyan-100 hover:bg-white/10"
                onClick={togglePlayPause}
                title={isPlaying ? 'Pause' : 'Abspielen'}
              >
                {isPlaying ? <Pause size={18} /> : <Music4 size={18} />}
              </button>
              <button
                className="absolute -bottom-1 -right-1 rounded-md border border-white/20 bg-black/60 p-0.5 text-zinc-200"
                onPointerDown={startDrag}
                title="Player verschieben"
              >
                <GripVertical size={12} />
              </button>
            </motion.div>

            <motion.div
              className="absolute inset-0 z-10 flex h-full flex-col p-3"
              animate={{
                opacity: isExpanded ? 1 : 0,
                y: isExpanded ? 0 : 10,
                scale: isExpanded ? 1 : 0.965,
                filter: isExpanded ? 'blur(0px)' : 'blur(3px)',
              }}
              transition={{
                opacity: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
                y: { type: 'spring', stiffness: 420, damping: 34, mass: 0.7 },
                scale: { type: 'spring', stiffness: 430, damping: 34, mass: 0.66 },
                filter: { duration: 0.2 },
              }}
              style={{ pointerEvents: isExpanded ? 'auto' : 'none' }}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-cyan-100">{currentTrack.name}</p>
                  <p className="text-xs text-zinc-300">
                    {isLoading ? 'Lädt...' : isPlaying ? 'Wird abgespielt' : 'Pausiert'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    className="rounded-lg border border-white/20 p-1.5 text-zinc-200 hover:bg-white/10"
                    onPointerDown={startDrag}
                    title="Player verschieben"
                  >
                    <GripVertical size={14} />
                  </button>
                  <button
                    className="rounded-lg border border-white/20 p-1.5 text-zinc-200 hover:bg-white/10"
                    onClick={() => setCompactMode((value) => !value)}
                    title={compactMode ? 'Anheften' : 'Kompaktmodus'}
                  >
                    {compactMode ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
                  </button>
                  <button
                    className="rounded-lg border border-white/20 p-1.5 text-zinc-200 hover:bg-white/10"
                    onClick={stop}
                    title="Stoppen"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>

              <div className="mb-2 flex items-center gap-2">
                <button
                  className="rounded-lg border border-white/20 p-2 text-zinc-200 hover:bg-white/10 disabled:opacity-40"
                  onClick={playPrev}
                  disabled={currentIndex <= 0}
                  title="Vorheriger Titel"
                >
                  <SkipBack size={15} />
                </button>
                <button
                  className="rounded-lg border border-cyan-300/30 bg-cyan-500/20 p-2 text-cyan-100 hover:bg-cyan-400/25"
                  onClick={togglePlayPause}
                  title={isPlaying ? 'Pause' : 'Abspielen'}
                >
                  {isPlaying ? <Pause size={15} /> : <Play size={15} />}
                </button>
                <button
                  className="rounded-lg border border-white/20 p-2 text-zinc-200 hover:bg-white/10 disabled:opacity-40"
                  onClick={playNext}
                  disabled={currentIndex >= queue.length - 1}
                  title="Nächster Titel"
                >
                  <SkipForward size={15} />
                </button>

                <div className="ml-2 flex min-w-0 flex-1 items-center gap-2">
                  <span className="w-10 text-right text-xs text-zinc-300">{formatTime(currentTime)}</span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(duration || 0, 1)}
                    step={0.1}
                    value={Math.min(currentTime, duration || 0)}
                    onChange={(event) => seekTo(Number(event.target.value))}
                    className="w-full accent-cyan-400"
                  />
                  <span className="w-10 text-xs text-zinc-300">{formatTime(duration)}</span>
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Volume1 size={14} className="text-zinc-300" />
                <ElasticSlider
                  className="max-w-[260px]"
                  minValue={0}
                  maxValue={100}
                  value={Math.round(volume * 100)}
                  onChange={(next) => setVolume(next / 100)}
                  isStepped
                  stepSize={1}
                  leftIcon={<Volume1 size={13} />}
                  rightIcon={<Volume2 size={13} />}
                />
                <span className="w-9 text-right text-xs text-zinc-300">{Math.round(volume * 100)}</span>
              </div>
            </motion.div>
          </motion.section>
        </div>
      ) : null}
    </GlobalMediaPlayerContext.Provider>
  );
}

export function useGlobalMediaPlayer(): GlobalMediaPlayerContextValue {
  const context = useContext(GlobalMediaPlayerContext);
  if (!context) {
    throw new Error('useGlobalMediaPlayer muss innerhalb von GlobalMediaPlayerProvider verwendet werden');
  }
  return context;
}
