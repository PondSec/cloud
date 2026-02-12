import { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

import { ideApiBaseUrl } from '../lib/ide-api';

interface TerminalPanelProps {
  workspaceId: string;
  token: string;
}

export function TerminalPanel({ workspaceId, token }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 12,
      theme: {
        background: '#1e1e1e',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    const wsBase = ideApiBaseUrl().replace(/^http/, 'ws');
    const ws = new WebSocket(
      `${wsBase}/ws/terminal?workspaceId=${encodeURIComponent(workspaceId)}&token=${encodeURIComponent(token)}`,
    );

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        }),
      );
    };

    ws.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as { type: string; data?: string };
      if (payload.type === 'output' && payload.data) {
        term.write(payload.data);
      }
    };

    term.onData((data) => {
      ws.send(JSON.stringify({ type: 'input', data }));
    });

    const onResize = () => {
      fitAddon.fit();
      ws.send(
        JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        }),
      );
    };

    window.addEventListener('resize', onResize);

    termRef.current = term;
    wsRef.current = ws;

    return () => {
      window.removeEventListener('resize', onResize);
      ws.close();
      term.dispose();
    };
  }, [workspaceId, token]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
}
