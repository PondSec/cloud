import { useQuery } from '@tanstack/react-query';
import {
  Film,
  Image as ImageIcon,
  Music2,
  Pause,
  Play,
  RefreshCw,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import TiltedCard from '@/components/reactbits/TiltedCard';
import { useGlobalMediaPlayer } from '@/contexts/GlobalMediaPlayerContext';
import { api, toApiMessage } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/utils';
import type { FileNode, FolderTreeNode } from '@/types/api';

type MediaTab = 'gallery' | 'music';

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

const VIDEO_EXTENSIONS = new Set([
  'mp4',
  'webm',
  'mov',
  'mkv',
  'avi',
  'm4v',
  '3gp',
  'mpeg',
  'mpg',
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'flac',
  'ogg',
  'oga',
  'm4a',
  'aac',
  'opus',
  'wma',
]);

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

function isImage(node: FileNode): boolean {
  const mime = node.mime?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return true;
  return IMAGE_EXTENSIONS.has(extensionOf(node.name));
}

function isVideo(node: FileNode): boolean {
  const mime = node.mime?.toLowerCase() ?? '';
  if (mime.startsWith('video/')) return true;
  return VIDEO_EXTENSIONS.has(extensionOf(node.name));
}

function isAudio(node: FileNode): boolean {
  const mime = node.mime?.toLowerCase() ?? '';
  if (mime.startsWith('audio/')) return true;
  return AUDIO_EXTENSIONS.has(extensionOf(node.name));
}

function collectFolderIds(nodes: FolderTreeNode[]): number[] {
  const ids: number[] = [];
  const stack = [...nodes];
  while (stack.length) {
    const current = stack.pop()!;
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

export function MediaPage() {
  const [activeTab, setActiveTab] = useState<MediaTab>('gallery');
  const [activePreview, setActivePreview] = useState<FileNode | null>(null);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);

  const assetUrlsRef = useRef<Map<number, string>>(new Map());
  const pendingAssetLoadsRef = useRef<Map<number, Promise<string>>>(new Map());
  const [assetUrls, setAssetUrls] = useState<Record<number, string>>({});

  const { playTrack, currentTrack, isPlaying } = useGlobalMediaPlayer();

  const mediaQuery = useQuery({
    queryKey: ['files', 'media-library'],
    queryFn: loadAllFileNodes,
  });

  const galleryItems = useMemo(
    () => (mediaQuery.data ?? []).filter((node) => isImage(node) || isVideo(node)),
    [mediaQuery.data],
  );

  const musicItems = useMemo(
    () => (mediaQuery.data ?? []).filter((node) => isAudio(node)),
    [mediaQuery.data],
  );

  const ensureAssetUrl = useCallback(async (node: FileNode): Promise<string> => {
    const cached = assetUrlsRef.current.get(node.id);
    if (cached) return cached;

    const pending = pendingAssetLoadsRef.current.get(node.id);
    if (pending) return pending;

    const request = api.files
      .blob(node.id)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        assetUrlsRef.current.set(node.id, url);
        setAssetUrls((prev) => ({ ...prev, [node.id]: url }));
        return url;
      })
      .finally(() => {
        pendingAssetLoadsRef.current.delete(node.id);
      });

    pendingAssetLoadsRef.current.set(node.id, request);
    return request;
  }, []);

  useEffect(() => {
    if (activeTab !== 'gallery') return;
    let cancelled = false;

    const preloadGalleryMedia = async () => {
      const preloadItems = galleryItems.slice(0, 24);
      for (const item of preloadItems) {
        if (cancelled) return;
        try {
          await ensureAssetUrl(item);
        } catch {
          // Skip failed preview items.
        }
      }
    };

    void preloadGalleryMedia();
    return () => {
      cancelled = true;
    };
  }, [activeTab, ensureAssetUrl, galleryItems]);

  useEffect(() => {
    return () => {
      for (const url of assetUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      assetUrlsRef.current.clear();
      pendingAssetLoadsRef.current.clear();
    };
  }, []);

  const openPreview = async (node: FileNode) => {
    setActivePreview(node);
    setPreviewLoading(true);
    try {
      const url = await ensureAssetUrl(node);
      setActivePreviewUrl(url);
    } catch {
      setActivePreviewUrl('');
    } finally {
      setPreviewLoading(false);
    }
  };

  const closePreview = () => {
    setActivePreview(null);
    setActivePreviewUrl('');
    setPreviewLoading(false);
  };

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Media</h1>
          <p className="text-sm text-zinc-300">Gallery for images/videos and a music library with global playback.</p>
        </div>

        <button
          className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-black/20 px-3 py-2 text-sm hover:bg-white/10"
          onClick={() => mediaQuery.refetch()}
          disabled={mediaQuery.isFetching}
        >
          <RefreshCw size={14} className={mediaQuery.isFetching ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="mb-4 inline-flex rounded-xl border border-white/15 bg-black/30 p-1">
        <button
          className={`rounded-lg px-3 py-1.5 text-sm ${activeTab === 'gallery' ? 'bg-cyan-500/25 text-cyan-100' : 'text-zinc-200 hover:bg-white/10'}`}
          onClick={() => setActiveTab('gallery')}
        >
          Gallery
        </button>
        <button
          className={`rounded-lg px-3 py-1.5 text-sm ${activeTab === 'music' ? 'bg-cyan-500/25 text-cyan-100' : 'text-zinc-200 hover:bg-white/10'}`}
          onClick={() => setActiveTab('music')}
        >
          Music
        </button>
      </div>

      {mediaQuery.isLoading ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">Loading media library...</div>
      ) : mediaQuery.isError ? (
        <div className="rounded-2xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100">
          {toApiMessage(mediaQuery.error)}
        </div>
      ) : activeTab === 'gallery' ? (
        galleryItems.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
            No images or videos found in your cloud files.
          </div>
        ) : (
          <div className="space-y-2">
            <p className="px-1 text-xs uppercase tracking-[0.12em] text-zinc-400">Hover for tilt, click for preview</p>
            <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
              <div className="grid justify-center gap-4 [grid-template-columns:repeat(auto-fill,minmax(220px,220px))]">
                {galleryItems.map((item) => {
                  const video = isVideo(item);
                  const mediaUrl = assetUrls[item.id];
                  return (
                    <TiltedCard
                      key={item.id}
                      mediaSrc={mediaUrl}
                      mediaType={video ? 'video' : 'image'}
                      altText={item.name}
                      captionText={`${video ? 'VIDEO' : 'IMAGE'} · ${formatBytes(item.size)}`}
                      containerHeight="240px"
                      containerWidth="220px"
                      mediaHeight="240px"
                      mediaWidth="220px"
                      rotateAmplitude={10}
                      scaleOnHover={1.03}
                      showMobileWarning={false}
                      showTooltip
                      displayOverlayContent
                      onClick={() => void openPreview(item)}
                      overlayContent={
                        <div className="pointer-events-none flex h-full flex-col justify-between p-2">
                          <span
                            className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] ${
                              video
                                ? 'border-amber-300/40 bg-amber-500/15 text-amber-100'
                                : 'border-cyan-300/45 bg-cyan-500/15 text-cyan-100'
                            }`}
                          >
                            {video ? <Film size={11} /> : <ImageIcon size={11} />}
                            {video ? 'VIDEO' : 'IMAGE'}
                          </span>
                          <div className="rounded-lg border border-white/10 bg-black/35 p-2 backdrop-blur-sm">
                            <p className="truncate text-xs font-semibold text-zinc-100">{item.name}</p>
                            <p className="truncate text-[11px] text-zinc-300">
                              {formatBytes(item.size)} · {formatDate(item.updated_at)}
                            </p>
                          </div>
                        </div>
                      }
                    />
                  );
                })}
              </div>
            </div>
          </div>
        )
      ) : musicItems.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">No music files found in your cloud.</div>
      ) : (
        <div className="space-y-2">
          {musicItems.map((track) => {
            const isCurrent = currentTrack?.id === track.id;
            const isCurrentPlaying = isCurrent && isPlaying;
            return (
              <div
                key={track.id}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                  isCurrent ? 'border-cyan-300/40 bg-cyan-500/10' : 'border-white/10 bg-black/20'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    className="rounded-lg border border-white/20 p-2 text-zinc-100 hover:bg-white/10"
                    onClick={() => playTrack(track, musicItems)}
                    title={isCurrentPlaying ? 'Playing' : 'Play'}
                  >
                    {isCurrentPlaying ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <Music2 size={16} className="shrink-0 text-zinc-400" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-100">{track.name}</p>
                    <p className="text-xs text-zinc-400">{track.mime || 'audio/*'}</p>
                  </div>
                </div>
                <div className="shrink-0 text-xs text-zinc-400">{formatBytes(track.size)}</div>
              </div>
            );
          })}
        </div>
      )}

      {activePreview ? (
        <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-5xl overflow-hidden rounded-2xl border border-white/15 bg-[#050a18]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-zinc-100">{activePreview.name}</p>
                <p className="text-xs text-zinc-400">{formatBytes(activePreview.size)}</p>
              </div>
              <button className="rounded-lg border border-white/20 p-1.5 text-zinc-200 hover:bg-white/10" onClick={closePreview}>
                <X size={14} />
              </button>
            </div>

            <div className="max-h-[78vh] overflow-auto p-4">
              {previewLoading ? (
                <div className="rounded-xl border border-white/10 bg-black/20 p-6 text-sm text-zinc-300">Loading preview...</div>
              ) : activePreviewUrl ? (
                isImage(activePreview) ? (
                  <img src={activePreviewUrl} alt={activePreview.name} className="mx-auto max-h-[72vh] w-auto rounded-xl object-contain" />
                ) : (
                  <video src={activePreviewUrl} controls className="mx-auto max-h-[72vh] w-full rounded-xl bg-black" />
                )
              ) : (
                <div className="rounded-xl border border-rose-400/40 bg-rose-500/10 p-4 text-sm text-rose-100">
                  Preview could not be loaded for this file.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
