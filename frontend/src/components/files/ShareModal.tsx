import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Trash2, Users, Globe } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import GlassSurface from '@/components/reactbits/GlassSurface';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, toApiMessage } from '@/lib/api';
import type { FileNode, ShareAccess } from '@/types/api';

interface ShareModalProps {
  open: boolean;
  node: FileNode | null;
  onClose: () => void;
}

async function copyToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fallback below.
    }
  }
  const temp = document.createElement('textarea');
  temp.value = value;
  temp.setAttribute('readonly', 'true');
  temp.style.position = 'absolute';
  temp.style.left = '-9999px';
  document.body.appendChild(temp);
  temp.select();
  temp.setSelectionRange(0, temp.value.length);
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    document.body.removeChild(temp);
  }
  return copied;
}

function accessLabel(access: ShareAccess): string {
  return access === 'write' ? 'Schreiben' : 'Lesen';
}

export function ShareModal({ open, node, onClose }: ShareModalProps) {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');
  const [access, setAccess] = useState<ShareAccess>('read');
  const [expiresInDays, setExpiresInDays] = useState('7');

  const nodeId = node?.id ?? null;

  const internalQuery = useQuery({
    queryKey: ['shares', 'internal', nodeId],
    queryFn: () => api.shares.listInternal(nodeId as number),
    enabled: open && nodeId !== null,
  });

  const externalQuery = useQuery({
    queryKey: ['shares', 'external', nodeId],
    queryFn: () => api.shares.listExternal(nodeId as number),
    enabled: open && nodeId !== null,
  });

  const upsertInternalMutation = useMutation({
    mutationFn: () => api.shares.upsertInternal({ file_id: nodeId as number, username, access }),
    onSuccess: async () => {
      setUsername('');
      toast.success('Interne Freigabe gespeichert');
      await queryClient.invalidateQueries({ queryKey: ['shares', 'internal', nodeId] });
      await queryClient.invalidateQueries({ queryKey: ['shares', 'shared-with-me'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const deleteInternalMutation = useMutation({
    mutationFn: (shareId: number) => api.shares.deleteInternal(shareId),
    onSuccess: async () => {
      toast.success('Interne Freigabe entfernt');
      await queryClient.invalidateQueries({ queryKey: ['shares', 'internal', nodeId] });
      await queryClient.invalidateQueries({ queryKey: ['shares', 'shared-with-me'] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const createExternalMutation = useMutation({
    mutationFn: () => {
      const trimmed = expiresInDays.trim();
      const parsed = trimmed ? Number(trimmed) : null;
      return api.shares.createExternal({
        file_id: nodeId as number,
        expires_in_days: trimmed ? parsed : null,
      });
    },
    onSuccess: async (link) => {
      toast.success('Externer Link erstellt');
      const copied = await copyToClipboard(link.public_url);
      if (copied) {
        toast.success('Link in die Zwischenablage kopiert');
      } else {
        toast.info('Link erstellt. Der Browser hat den Zugriff auf die Zwischenablage blockiert.');
      }
      await queryClient.invalidateQueries({ queryKey: ['shares', 'external', nodeId] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const deleteExternalMutation = useMutation({
    mutationFn: (linkId: number) => api.shares.deleteExternal(linkId),
    onSuccess: async () => {
      toast.success('Externer Link entfernt');
      await queryClient.invalidateQueries({ queryKey: ['shares', 'external', nodeId] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const hasNode = useMemo(() => Boolean(node && nodeId !== null), [node, nodeId]);

  if (!open || !hasNode || !node) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/45 p-4">
      <GlassSurface width={760} height="auto" borderRadius={22} className="w-full max-w-3xl border border-white/20">
        <div className="w-full space-y-5 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">"{node.name}" freigeben</h3>
              <p className="text-sm text-zinc-300">Vergeben Sie interne und externe Zugriffe gezielt für Ihr Team.</p>
            </div>
            <Button variant="secondary" onClick={onClose}>
              Schließen
            </Button>
          </div>

          <section className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Users size={16} className="text-cyan-200" />
              Interne Freigabe
            </div>

            <div className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
              <Input
                placeholder="Benutzername (z. B. alice)"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
              <select
                className="h-10 rounded-xl border border-white/20 bg-white/10 px-3 text-sm text-zinc-100"
                value={access}
                onChange={(event) => setAccess(event.target.value as ShareAccess)}
              >
                <option value="read">Lesen</option>
                <option value="write">Schreiben</option>
              </select>
              <Button
                onClick={() => upsertInternalMutation.mutate()}
                disabled={upsertInternalMutation.isPending || username.trim().length < 3}
              >
                Freigeben
              </Button>
            </div>

            <div className="max-h-44 space-y-2 overflow-auto rounded-xl border border-white/10 bg-black/20 p-2">
              {(internalQuery.data ?? []).map((share) => (
                <div key={share.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-2 py-2">
                  <div className="text-sm">
                    <p className="font-medium">{share.shared_with_username ?? `Benutzer #${share.shared_with_user_id}`}</p>
                    <p className="text-xs uppercase text-zinc-400">{accessLabel(share.access)}</p>
                  </div>
                  <Button
                    variant="destructive"
                    size="icon"
                    aria-label="Interne Freigabe entfernen"
                    onClick={() => deleteInternalMutation.mutate(share.id)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
              {!internalQuery.isLoading && (internalQuery.data?.length ?? 0) === 0 ? (
                <p className="px-2 py-3 text-sm text-zinc-400">Noch keine internen Freigaben vorhanden.</p>
              ) : null}
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Globe size={16} className="text-cyan-200" />
              Externe Links
            </div>

            <div className="grid gap-2 md:grid-cols-[1fr_auto]">
              <Input
                value={expiresInDays}
                onChange={(event) => setExpiresInDays(event.target.value)}
                placeholder="Ablauf in Tagen (leer = kein Ablauf)"
              />
              <Button onClick={() => createExternalMutation.mutate()} disabled={createExternalMutation.isPending}>
                Link erstellen
              </Button>
            </div>

            <div className="max-h-52 space-y-2 overflow-auto rounded-xl border border-white/10 bg-black/20 p-2">
              {(externalQuery.data ?? []).map((link) => (
                <div key={link.id} className="space-y-2 rounded-lg border border-white/10 px-2 py-2">
                  <p className="truncate text-xs text-zinc-300">{link.public_url}</p>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-zinc-400">
                      {link.expires_at ? `Läuft ab: ${new Date(link.expires_at).toLocaleString()}` : 'Kein Ablauf'}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="secondary"
                        size="icon"
                        aria-label="Externen Link kopieren"
                        onClick={async () => {
                          const copied = await copyToClipboard(link.public_url);
                          if (copied) {
                            toast.success('Link in die Zwischenablage kopiert');
                          } else {
                            toast.info('Der Browser hat den Zugriff auf die Zwischenablage blockiert.');
                          }
                        }}
                      >
                        <Copy size={14} />
                      </Button>
                      <Button
                        variant="destructive"
                        size="icon"
                        aria-label="Externen Link löschen"
                        onClick={() => deleteExternalMutation.mutate(link.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              {!externalQuery.isLoading && (externalQuery.data?.length ?? 0) === 0 ? (
                <p className="px-2 py-3 text-sm text-zinc-400">Noch keine externen Links vorhanden.</p>
              ) : null}
            </div>
          </section>
        </div>
      </GlassSurface>
    </div>
  );
}
