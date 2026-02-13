import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Mail, Plus, RefreshCw, Settings, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, toApiMessage } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';

function InlineError({ title, error }: { title: string; error: unknown }) {
  const message = toApiMessage(error);
  return (
    <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-xs text-rose-100/90">{message}</p>
    </div>
  );
}

function sanitizeEmailHtmlFragment(html: string): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    doc.querySelectorAll('script, style, link, iframe, object, embed').forEach((el) => el.remove());

    doc.querySelectorAll('*').forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        const name = attr.name.toLowerCase();
        const value = (attr.value || '').trim().toLowerCase();
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        if (name === 'srcdoc') el.removeAttribute(attr.name);
        if (name === 'href' && value.startsWith('javascript:')) el.removeAttribute(attr.name);
      });
    });

    doc.querySelectorAll('img').forEach((img) => {
      img.setAttribute('data-blocked-src', img.getAttribute('src') || '');
      img.removeAttribute('src');
      img.setAttribute('alt', img.getAttribute('alt') || '[Bild blockiert]');
    });

    doc.querySelectorAll('a').forEach((a) => {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noreferrer noopener');
    });

    return doc.body.innerHTML;
  } catch {
    return '';
  }
}

function recipientsFromText(value: string): string[] {
  return (value || '')
    .split(/[;,]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function EmailPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [showHtml, setShowHtml] = useState(false);

  const accountsQuery = useQuery({
    queryKey: ['mail', 'accounts'],
    queryFn: api.mail.accounts,
  });

  const accountIdParam = Number(searchParams.get('accountId') || '');
  const mailbox = (searchParams.get('mailbox') || 'INBOX').trim() || 'INBOX';
  const uid = (searchParams.get('uid') || '').trim();

  const accounts = accountsQuery.data ?? [];
  const activeAccountId = useMemo(() => {
    if (Number.isFinite(accountIdParam) && accountIdParam > 0 && accounts.some((a) => a.id === accountIdParam)) return accountIdParam;
    return accounts[0]?.id ?? null;
  }, [accountIdParam, accounts]);

  const activeAccount = useMemo(() => accounts.find((a) => a.id === activeAccountId) ?? null, [accounts, activeAccountId]);

  const mailboxesQuery = useQuery({
    queryKey: ['mail', 'mailboxes-status', activeAccountId],
    queryFn: () => api.mail.mailboxesStatus(activeAccountId as number),
    enabled: Boolean(activeAccountId),
  });

  const messagesQuery = useQuery({
    queryKey: ['mail', 'messages', activeAccountId, mailbox],
    queryFn: () => api.mail.messages(activeAccountId as number, mailbox, 60, 0),
    enabled: Boolean(activeAccountId),
  });

  const messageQuery = useQuery({
    queryKey: ['mail', 'message', activeAccountId, mailbox, uid],
    queryFn: () => api.mail.message(activeAccountId as number, uid, mailbox),
    enabled: Boolean(activeAccountId && uid),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const to = recipientsFromText(composeTo);
      await api.mail.send(activeAccountId as number, { to, subject: composeSubject, body_text: composeBody });
    },
    onSuccess: () => {
      toast.success('Email gesendet.');
      setComposeOpen(false);
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      void queryClient.invalidateQueries({ queryKey: ['mail', 'messages', activeAccountId] });
    },
    onError: (error) => toast.error(toApiMessage(error)),
  });

  const selectedMessage = messageQuery.data ?? null;
  const sanitizedHtmlSrcDoc = useMemo(() => {
    const fragment = selectedMessage?.body_html ? sanitizeEmailHtmlFragment(selectedMessage.body_html) : '';
    if (!fragment) return '';
    const baseCss = `
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"; color: #e4e4e7; background: transparent; }
      a { color: #67e8f9; }
      pre { white-space: pre-wrap; }
      img { opacity: 0.75; }
    `;
    return `<!doctype html><html><head><meta charset="utf-8"/><style>${baseCss}</style></head><body>${fragment}</body></html>`;
  }, [selectedMessage?.body_html]);

  const ensureParams = useCallback(
    (next: Record<string, string | number | null>) => {
      const merged = new URLSearchParams(searchParams);
      Object.entries(next).forEach(([key, value]) => {
        if (value === null || value === undefined || value === '') merged.delete(key);
        else merged.set(key, String(value));
      });
      setSearchParams(merged, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (activeAccountId && accountIdParam !== activeAccountId) {
      ensureParams({ accountId: activeAccountId });
    }
  }, [accountIdParam, activeAccountId, ensureParams]);

  if (accountsQuery.isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-zinc-300">
        <Loader2 size={18} className="mr-2 animate-spin" />
        Email wird geladen
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div className="h-full overflow-auto p-6">
        <div className="rounded-2xl border border-white/10 bg-black/20 p-6">
          <div className="mb-3 flex items-center gap-2">
            <Mail size={18} className="text-cyan-300" />
            <h1 className="text-xl font-semibold text-zinc-100">Email</h1>
          </div>
          <p className="text-sm text-zinc-300">Noch kein Email-Konto eingerichtet.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="default" onClick={() => navigate('/app/settings')}>
              <Settings size={14} className="mr-2" />
              Zu den Einstellungen
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const mailboxes = mailboxesQuery.data ?? [];
  const messages = messagesQuery.data ?? [];

  const inboxAlternateHint = useMemo(() => {
    const inbox = mailboxes.find((box) => box.name.toUpperCase() === 'INBOX');
    if (!inbox || inbox.messages !== 0) return null;
    const alternatives = mailboxes
      .filter((box) => box.name.toUpperCase() !== 'INBOX' && typeof box.messages === 'number' && box.messages > 0)
      .slice(0, 3)
      .map((box) => box.name);
    if (alternatives.length === 0) return null;
    return alternatives.join(', ');
  }, [mailboxes]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold text-zinc-100">Email</h1>
          <p className="truncate text-sm text-zinc-300">{activeAccount?.email_address}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void messagesQuery.refetch();
              void mailboxesQuery.refetch();
            }}
            disabled={messagesQuery.isFetching || mailboxesQuery.isFetching}
          >
            <RefreshCw size={14} className="mr-2" />
            Aktualisieren
          </Button>
          <Button variant="default" onClick={() => setComposeOpen(true)}>
            <Plus size={14} className="mr-2" />
            Neu
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 md:grid-cols-[280px_380px_1fr]">
        <div className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-black/20 p-3">
          <div className="space-y-3">
            <label className="space-y-1 text-sm text-zinc-200">
              <span>Konto</span>
              <select
                className="w-full rounded-md border border-white/15 bg-black/35 px-2 py-1.5 text-sm"
                value={activeAccountId ?? ''}
                onChange={(event) => ensureParams({ accountId: Number(event.target.value || 0) || null, mailbox: null, uid: null })}
              >
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.label ? `${account.label} · ` : ''}
                    {account.email_address}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-zinc-300">Ordner</p>
                {mailboxesQuery.isLoading ? <Loader2 size={12} className="animate-spin text-zinc-400" /> : null}
              </div>
              {mailboxesQuery.isError ? <InlineError title="Ordner konnten nicht geladen werden" error={mailboxesQuery.error} /> : null}
              <div className="space-y-1">
                {(mailboxes.length > 0 ? mailboxes : [{ name: 'INBOX', messages: null, unseen: null }]).map((box) => (
                  <button
                    key={box.name}
                    type="button"
                    onClick={() => ensureParams({ mailbox: box.name, uid: null })}
                    className={cn(
                      'w-full rounded-xl border px-3 py-2 text-left text-sm transition',
                      mailbox === box.name
                        ? 'border-cyan-300/30 bg-cyan-400/10 text-cyan-100'
                        : 'border-white/10 bg-black/25 text-zinc-200 hover:bg-white/5',
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate">{box.name}</span>
                      <span className="shrink-0 text-[11px] text-zinc-400">
                        {typeof box.messages === 'number' ? box.messages : ''}
                        {typeof box.unseen === 'number' && box.unseen > 0 ? ` · ${box.unseen} neu` : ''}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {inboxAlternateHint ? <p className="mt-2 text-xs text-zinc-400">Tipp: INBOX ist leer. Mails gefunden in: {inboxAlternateHint}</p> : null}
            </div>

            <Button variant="ghost" onClick={() => navigate('/app/settings')} className="w-full justify-start">
              <Settings size={14} className="mr-2" />
              Konten verwalten
            </Button>
          </div>
        </div>

        <div className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-black/20">
          <div className="sticky top-0 z-10 border-b border-white/10 bg-black/30 px-3 py-2">
            <p className="text-xs font-medium text-zinc-300">
              {mailbox} · {messagesQuery.isLoading ? 'laedt' : `${messages.length} Nachrichten`}
            </p>
          </div>
          <div className="space-y-1 p-2">
            {messagesQuery.isError ? <InlineError title="Nachrichten konnten nicht geladen werden" error={messagesQuery.error} /> : null}
            {messagesQuery.isLoading ? (
              <div className="flex items-center gap-2 p-3 text-sm text-zinc-300">
                <Loader2 size={14} className="animate-spin" />
                Nachrichten werden geladen
              </div>
            ) : messages.length === 0 ? (
              <p className="p-3 text-sm text-zinc-400">Keine Nachrichten.</p>
            ) : (
              messages.map((msg) => (
                <button
                  key={msg.uid}
                  type="button"
                  onClick={() => ensureParams({ uid: msg.uid })}
                  className={cn(
                    'w-full rounded-xl border px-3 py-2 text-left transition',
                    uid === msg.uid ? 'border-cyan-300/30 bg-cyan-400/10' : 'border-white/10 bg-black/20 hover:bg-white/5',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn('truncate text-sm', msg.seen ? 'text-zinc-200' : 'text-zinc-50 font-semibold')}>{msg.subject || '(Ohne Betreff)'}</p>
                    <span className="shrink-0 text-[11px] text-zinc-400">{msg.date ? formatDate(msg.date) : ''}</span>
                  </div>
                  <p className="truncate text-xs text-zinc-400">
                    {msg.from_name ? `${msg.from_name} ` : ''}
                    {msg.from_email}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="min-h-0 overflow-auto rounded-2xl border border-white/10 bg-black/20">
          {!uid ? (
            <div className="flex h-full items-center justify-center p-6 text-sm text-zinc-400">Waehlen Sie eine Nachricht aus.</div>
          ) : messageQuery.isLoading ? (
            <div className="flex items-center gap-2 p-6 text-sm text-zinc-300">
              <Loader2 size={14} className="animate-spin" />
              Nachricht wird geladen
            </div>
          ) : messageQuery.isError ? (
            <div className="p-4">
              <InlineError title="Nachricht konnte nicht geladen werden" error={messageQuery.error} />
            </div>
          ) : selectedMessage ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-white/10 bg-black/25 p-4">
                <p className="text-lg font-semibold text-zinc-100">{selectedMessage.subject || '(Ohne Betreff)'}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-400">
                  <span>
                    Von: {selectedMessage.from?.name ? `${selectedMessage.from.name} ` : ''}
                    {selectedMessage.from?.email}
                  </span>
                  {selectedMessage.date ? <span>{formatDate(selectedMessage.date)}</span> : null}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant={showHtml ? 'secondary' : 'default'} size="sm" onClick={() => setShowHtml(false)}>
                    Text
                  </Button>
                  <Button variant={showHtml ? 'default' : 'secondary'} size="sm" onClick={() => setShowHtml(true)} disabled={!selectedMessage.body_html}>
                    HTML
                  </Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-auto p-4">
                {showHtml && sanitizedHtmlSrcDoc ? (
                  <iframe
                    title="Email HTML"
                    sandbox="allow-popups"
                    className="h-full w-full rounded-xl border border-white/10 bg-black/20"
                    srcDoc={sanitizedHtmlSrcDoc}
                  />
                ) : (
                  <pre className="whitespace-pre-wrap text-sm text-zinc-200">{selectedMessage.body_text || '(Kein Text-Inhalt)'}</pre>
                )}
              </div>
            </div>
          ) : (
            <div className="p-6 text-sm text-zinc-400">Nachricht konnte nicht geladen werden.</div>
          )}
        </div>
      </div>

      {composeOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-zinc-950/80 p-4 backdrop-blur">
            <div className="flex items-center justify-between gap-2">
              <p className="text-lg font-semibold text-zinc-100">Neue Email</p>
              <Button variant="ghost" size="icon" onClick={() => setComposeOpen(false)}>
                <X size={16} />
              </Button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="space-y-1 text-sm text-zinc-200">
                <span>An</span>
                <Input value={composeTo} onChange={(event) => setComposeTo(event.target.value)} placeholder="name@domain.tld, ..." />
              </label>
              <label className="space-y-1 text-sm text-zinc-200">
                <span>Betreff</span>
                <Input value={composeSubject} onChange={(event) => setComposeSubject(event.target.value)} placeholder="Betreff" />
              </label>
              <label className="space-y-1 text-sm text-zinc-200">
                <span>Nachricht</span>
                <textarea
                  className="min-h-[200px] w-full resize-y rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                  value={composeBody}
                  onChange={(event) => setComposeBody(event.target.value)}
                  placeholder="Schreiben Sie Ihre Nachricht..."
                />
              </label>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setComposeOpen(false)} disabled={sendMutation.isPending}>
                Abbrechen
              </Button>
              <Button
                variant="default"
                onClick={() => sendMutation.mutate()}
                disabled={sendMutation.isPending || !composeTo.trim()}
              >
                {sendMutation.isPending ? (
                  <>
                    <Loader2 size={14} className="mr-2 animate-spin" />
                    Sendet
                  </>
                ) : (
                  'Senden'
                )}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
