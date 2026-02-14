import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { House, Play } from 'lucide-react';
import { Link } from 'react-router-dom';

import { ActivityBar, type ActivityView } from '../components/ActivityBar';
import { CommandPalette } from '../components/CommandPalette';
import { FileQuickOpen } from '../components/FileQuickOpen';
import { EditorPane } from '../components/EditorPane';
import { EditorTabs } from '../components/EditorTabs';
import { ExplorerPanel } from '../components/ExplorerPanel';
import { PreviewPanel } from '../components/PreviewPanel';
import { RunPanel } from '../components/RunPanel';
import { SearchPanel } from '../components/SearchPanel';
import { SourceControlPanel } from '../components/SourceControlPanel';
import { StatusBar } from '../components/StatusBar';
import { TerminalPanel } from '../components/TerminalPanel';
import { ideApi, ideApiBaseUrl } from '../lib/ide-api';
import { clearIdeToken, getIdeToken } from '../lib/ide-auth';
import { useIdeStore } from '../state/ide-store';

export function IdePage() {
  const { workspaceId = '' } = useParams();
  const navigate = useNavigate();

  const {
    currentWorkspace,
    workspaceSettings,
    explorerPath,
    files,
    openFiles,
    activeFilePath,
    outputLines,
    problems,
    gitStatusRaw,
    bottomPanel,
    previewVisible,
    previewPort,
    setWorkspace,
    setExplorerPath,
    setFiles,
    openFile,
    closeFile,
    setActiveFile,
    updateOpenFileContent,
    markClean,
    renameOpenFilePath,
    renameOpenFilesByPrefix,
    removeOpenFilesByPrefix,
    appendOutput,
    clearOutput,
    setProblems,
    setGitStatusRaw,
    setBottomPanel,
    setPreviewVisible,
    setPreviewPort,
  } = useIdeStore();

  const token = getIdeToken();
  const [activeView, setActiveView] = useState<ActivityView>('explorer');
  const [runtimeStatus, setRuntimeStatus] = useState('Runner: unbekannt');
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [fileQuickOpenOpen, setFileQuickOpenOpen] = useState(false);
  const [gitDiffRaw, setGitDiffRaw] = useState('');
  const [debugCommand, setDebugCommand] = useState('');
  const [extensionCommand, setExtensionCommand] = useState('');
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0);
  const [recentFiles, setRecentFiles] = useState<string[]>([]);
  const revealSeqRef = useRef(1);
  const [reveal, setReveal] = useState<{ id: number; path: string; line: number; column: number } | null>(null);
  const previewReloadTimerRef = useRef<number | null>(null);
  const previewAutosaveTimerRef = useRef<number | null>(null);

  const activeFile = useMemo(
    () => openFiles.find((item) => item.path === activeFilePath) ?? null,
    [openFiles, activeFilePath],
  );
  const activeFileExt = useMemo(() => activeFile?.path.split('.').at(-1)?.toLowerCase() ?? '', [activeFile?.path]);
  const previewMode = useMemo<'app' | 'markdown'>(() => {
    if (['md', 'markdown', 'mdown'].includes(activeFileExt)) {
      return 'markdown';
    }
    return 'app';
  }, [activeFileExt]);

  const activeLanguage = useMemo(() => {
    if (!activeFile) return 'plaintext';
    const ext = activeFileExt;
    if (['ts', 'tsx'].includes(ext)) return 'typescript';
    if (['js', 'jsx'].includes(ext)) return 'javascript';
    if (ext === 'py') return 'python';
    if (['c', 'h'].includes(ext)) return 'c';
    return ext || 'plaintext';
  }, [activeFileExt, activeFile]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`studio.recents.${workspaceId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setRecentFiles(parsed.filter((v) => typeof v === 'string').slice(0, 60));
          return;
        }
      }
    } catch {
      // ignore
    }
    setRecentFiles([]);
  }, [workspaceId]);

  function rememberRecent(path: string): void {
    setRecentFiles((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)].slice(0, 60);
      try {
        window.localStorage.setItem(`studio.recents.${workspaceId}`, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  useEffect(() => {
    if (!activeFilePath) return;
    rememberRecent(activeFilePath);
  }, [activeFilePath]);

  async function loadWorkspace(): Promise<void> {
    if (!token) {
      navigate('/dev/workspaces', { replace: true });
      return;
    }

    try {
      const details = await ideApi.workspace.details(workspaceId);
      setWorkspace(details.workspace, details.settings);
      setRuntimeStatus(details.runtime.running ? 'Runner: aktiv' : 'Runner: gestoppt');
      const configuredPreviewCommand = details.settings.commands.preview?.trim() ?? '';
      const resolvedPreviewPort =
        details.settings.previewPort ??
        (details.workspace.template === 'python' && !configuredPreviewCommand ? 3000 : 0);
      setPreviewPort(resolvedPreviewPort);

      await ideApi.workspace.start(workspaceId);
      setRuntimeStatus('Runner: aktiv');

      await loadDir('');
      await refreshGit();
    } catch (error: any) {
      if (error.response?.status === 401) {
        clearIdeToken();
        navigate('/dev/workspaces', { replace: true });
        return;
      }
      appendOutput(`[error] ${error.response?.data?.error || error.message}`);
    }
  }

  async function loadDir(targetPath: string): Promise<void> {
    try {
      const items = await ideApi.files.list(workspaceId, targetPath);
      setExplorerPath(targetPath);
      setFiles(items);
    } catch (error: any) {
      appendOutput(`[error] ${error?.response?.data?.error || error.message}\n`);
    }
  }

  async function openPath(path: string, location?: { line: number; column: number }): Promise<void> {
    const node = files.find((item) => item.path === path);
    if (!path) {
      await loadDir('');
      return;
    }

    if (node?.type === 'directory') {
      await loadDir(node.path);
      return;
    }

    try {
      const content = await ideApi.files.read(workspaceId, path);
      openFile({
        path,
        content,
        language: activeLanguage,
        dirty: false,
      });
      rememberRecent(path);
      if (location) {
        setReveal({ id: revealSeqRef.current++, path, line: location.line, column: location.column });
      }
    } catch (error: any) {
      appendOutput(`[error] ${error?.response?.data?.error || error.message}\n`);
    }
  }

  async function saveActive(): Promise<void> {
    if (!activeFile) return;
    await ideApi.files.write(workspaceId, activeFile.path, activeFile.content);
    markClean(activeFile.path);
    queuePreviewRefresh(0);
    appendOutput(`[save] ${activeFile.path}`);
  }

  function queuePreviewRefresh(delayMs = 200): void {
    if (previewReloadTimerRef.current !== null) {
      window.clearTimeout(previewReloadTimerRef.current);
    }
    previewReloadTimerRef.current = window.setTimeout(() => {
      setPreviewRefreshToken((value) => value + 1);
      previewReloadTimerRef.current = null;
    }, delayMs);
  }

  async function refreshGit(): Promise<void> {
    try {
      const status = await ideApi.git.status(workspaceId);
      setGitStatusRaw(status);
      const diff = await ideApi.git.diff(workspaceId);
      setGitDiffRaw(diff);
    } catch (error: any) {
      setGitStatusRaw(error.response?.data?.error || 'Git status failed');
    }
  }

  async function runTask(task: 'run' | 'build' | 'test' | 'preview' | 'custom', command?: string): Promise<void> {
    if (!token) return;

    const configured = task === 'custom' ? command?.trim() || '' : workspaceSettings?.commands[task === 'preview' ? 'preview' : task]?.trim() || '';
    const fallbackPreviewCommand =
      task === 'preview' && !configured && currentWorkspace?.template === 'python' ? `python3 -m http.server ${previewPort || 3000}` : '';
    const raw = configured || fallbackPreviewCommand;
    if (!raw) {
      setBottomPanel('output');
      appendOutput(`\n[error] Für '${task}' ist kein Befehl konfiguriert. Hinterlegen Sie ihn in .cloudide.json oder verwenden Sie einen eigenen Befehl.`);
      return;
    }

    const normalized = raw.replace(/\bpython\b/g, 'python3');
    const effective =
      task === 'preview'
        ? `nohup sh -lc ${shellEscape(normalized)} >/tmp/cloudide-preview.log 2>&1 &`
        : normalized;

    setBottomPanel('output');
    appendOutput(`\n$ ${effective}\n`);
    try {
      const apiTask = task === 'preview' ? 'custom' : task;
      const result = await ideApi.tasks.run(workspaceId, apiTask, apiTask === 'custom' ? effective : undefined);
      if (result.stdout) {
        appendOutput(result.stdout);
      }
      if (result.stderr) {
        appendOutput(result.stderr);
      }
      appendOutput(`\n[exit ${result.exitCode}]`);
      if (task === 'preview') {
        queuePreviewRefresh(450);
      }
    } catch (error: any) {
      appendOutput(`[error] ${error?.response?.data?.error || error.message}\n`);
    }
  }

  async function renamePath(path: string): Promise<void> {
    const baseName = path.split('/').pop() || path;
    const nextName = window.prompt('Neuer Name', baseName);
    if (!nextName || nextName === baseName) return;

    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const target = parent ? `${parent}/${nextName}` : nextName;
    const node = files.find((item) => item.path === path);

    try {
      await ideApi.files.rename(workspaceId, path, target);
      if (node?.type === 'directory') {
        renameOpenFilesByPrefix(path, target);
      } else {
        renameOpenFilePath(path, target);
      }
      await loadDir(explorerPath);
      appendOutput(`[rename] ${path} -> ${target}\n`);
    } catch (error: any) {
      appendOutput(`[error] ${error?.response?.data?.error || error.message}\n`);
    }
  }

  async function movePath(path: string): Promise<void> {
    const target = window.prompt('Neuer Zielpfad (inkl. Datei-/Ordnername)', path);
    if (!target || target === path) return;
    const node = files.find((item) => item.path === path);

    try {
      await ideApi.files.rename(workspaceId, path, target);
      if (node?.type === 'directory') {
        renameOpenFilesByPrefix(path, target);
      } else {
        renameOpenFilePath(path, target);
      }
      await loadDir(explorerPath);
      appendOutput(`[move] ${path} -> ${target}\n`);
    } catch (error: any) {
      appendOutput(`[error] ${error?.response?.data?.error || error.message}\n`);
    }
  }

  async function deletePath(path: string): Promise<void> {
    if (!window.confirm(`'${path}' wirklich löschen?`)) return;
    try {
      await ideApi.files.remove(workspaceId, path);
      removeOpenFilesByPrefix(path);
      await loadDir(explorerPath);
      appendOutput(`[delete] ${path}\n`);
    } catch (error: any) {
      appendOutput(`[error] ${error?.response?.data?.error || error.message}\n`);
    }
  }

  function shellEscape(value: string): string {
    return `'${value.replace(/'/g, `'"'"'`)}'`;
  }

  async function runActiveFile(): Promise<void> {
    if (!activeFile) {
      appendOutput('[error] Keine aktive Datei ausgewählt.\n');
      return;
    }
    const ext = activeFile.path.split('.').pop()?.toLowerCase() || '';
    let cmd = '';

    if (ext === 'py') cmd = `python3 ${shellEscape(activeFile.path)}`;
    else if (ext === 'js' || ext === 'mjs' || ext === 'cjs') cmd = `node ${shellEscape(activeFile.path)}`;
    else if (ext === 'c') cmd = `gcc -Wall -Wextra ${shellEscape(activeFile.path)} -o /tmp/cloudide-app && /tmp/cloudide-app`;
    else if (ext === 'sh') cmd = `bash ${shellEscape(activeFile.path)}`;

    if (cmd) {
      await runTask('custom', cmd);
      return;
    }
    await runTask('run');
  }

  useEffect(() => {
    void loadWorkspace();
  }, [workspaceId]);

  useEffect(() => {
    const wsBase = ideApiBaseUrl().replace(/^http/, 'ws');
    if (!token) return;
    const ws = new WebSocket(`${wsBase}/ws/files?workspaceId=${encodeURIComponent(workspaceId)}&token=${encodeURIComponent(token)}`);

    ws.onmessage = (event) => {
      void loadDir(explorerPath);
      if (!previewVisible || previewMode !== 'app') return;
      try {
        const payload = JSON.parse(String(event.data)) as { event?: string };
        if (!payload.event) return;
      } catch {
        return;
      }
      queuePreviewRefresh();
    };

    return () => ws.close();
  }, [workspaceId, explorerPath, token, previewVisible, previewMode]);

  useEffect(() => {
    if (!previewVisible || previewMode !== 'app' || !token || !activeFile || !activeFile.dirty) {
      if (previewAutosaveTimerRef.current !== null) {
        window.clearTimeout(previewAutosaveTimerRef.current);
        previewAutosaveTimerRef.current = null;
      }
      return;
    }

    if (previewAutosaveTimerRef.current !== null) {
      window.clearTimeout(previewAutosaveTimerRef.current);
    }

    const pendingPath = activeFile.path;
    const pendingContent = activeFile.content;
    previewAutosaveTimerRef.current = window.setTimeout(() => {
      void ideApi.files
        .write(workspaceId, pendingPath, pendingContent)
        .then(() => {
          markClean(pendingPath);
          queuePreviewRefresh(0);
        })
        .catch((error: any) => {
          appendOutput(`[error] ${error?.response?.data?.error || error.message}\n`);
        })
        .finally(() => {
          previewAutosaveTimerRef.current = null;
        });
    }, 450);

    return () => {
      if (previewAutosaveTimerRef.current !== null) {
        window.clearTimeout(previewAutosaveTimerRef.current);
        previewAutosaveTimerRef.current = null;
      }
    };
  }, [previewVisible, previewMode, token, workspaceId, activeFile, markClean]);

  useEffect(
    () => () => {
      if (previewReloadTimerRef.current !== null) {
        window.clearTimeout(previewReloadTimerRef.current);
      }
      if (previewAutosaveTimerRef.current !== null) {
        window.clearTimeout(previewAutosaveTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const isMod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (isMod && key === 'p' && event.shiftKey) {
        event.preventDefault();
        setFileQuickOpenOpen(false);
        setPaletteOpen(true);
        return;
      }

      if (isMod && key === 'p') {
        event.preventDefault();
        setPaletteOpen(false);
        setFileQuickOpenOpen(true);
        return;
      }

      if (isMod && event.shiftKey && key === 'f') {
        event.preventDefault();
        setActiveView('search');
        return;
      }

      if (isMod && key === 's') {
        event.preventDefault();
        void saveActive();
        return;
      }

      if (event.key === 'Escape') {
        setPaletteOpen(false);
        setFileQuickOpenOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeFile, workspaceSettings]);

  const commandPaletteItems = useMemo(
    () => [
      { id: 'file.open', title: 'Datei: Öffnen…', run: () => setFileQuickOpenOpen(true) },
      { id: 'files.refresh', title: 'Dateien: Aktualisieren', run: () => void loadDir(explorerPath) },
      { id: 'file.save', title: 'Datei: Aktive Datei speichern', run: () => void saveActive() },
      { id: 'search.workspace', title: 'Suche: Im Workspace suchen', run: () => setActiveView('search') },
      { id: 'git.refresh', title: 'Git: Status aktualisieren', run: () => void refreshGit() },
      { id: 'task.run', title: 'Tasks: Starten', run: () => void runTask('run') },
      { id: 'task.build', title: 'Tasks: Build', run: () => void runTask('build') },
      { id: 'task.test', title: 'Tasks: Tests', run: () => void runTask('test') },
      { id: 'preview.toggle', title: 'Ansicht: Vorschau umschalten', run: () => setPreviewVisible(!previewVisible) },
      { id: 'output.clear', title: 'Ausgabe: Leeren', run: () => clearOutput() },
    ],
    [explorerPath, previewVisible, workspaceSettings, activeFile],
  );

  const branch = gitStatusRaw.split('\n')[0]?.trim() || 'git';
  const escapedActivePath = activeFile ? shellEscape(activeFile.path) : '';
  const debugPresets = [
    {
      id: 'node-inspect',
      label: 'Node Debug (Inspector)',
      command: activeFile ? `node --inspect-brk ${escapedActivePath}` : '',
      enabled: ['js', 'mjs', 'cjs', 'ts', 'tsx'].includes(activeFileExt),
      note: 'Startet die aktive Datei mit Inspector auf Port 9229.',
    },
    {
      id: 'python-debugpy',
      label: 'Python Debug (debugpy)',
      command: activeFile ? `python3 -m debugpy --listen 0.0.0.0:5678 --wait-for-client ${escapedActivePath}` : '',
      enabled: activeFileExt === 'py',
      note: 'Startet die aktive Datei und wartet auf einen Debug-Client.',
    },
    {
      id: 'c-gdb',
      label: 'C Debug (gdb)',
      command: activeFile
        ? `gcc -g -O0 ${escapedActivePath} -o /tmp/cloudide-debug && gdb -q /tmp/cloudide-debug`
        : '',
      enabled: activeFileExt === 'c',
      note: 'Kompiliert mit Debug-Symbolen und öffnet gdb.',
    },
  ];

  const aptInstallCommand = (packages: string): string =>
    `if command -v apt-get >/dev/null 2>&1; then if [ "$(id -u)" -eq 0 ]; then apt-get update && apt-get install -y ${packages}; elif command -v sudo >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y ${packages}; else echo "[hinweis] apt-get gefunden, aber kein sudo/root. Bitte Workspace-Image erweitern: ${packages}"; exit 126; fi; else echo "[hinweis] apt-get ist in diesem Workspace nicht verfuegbar. Bitte Paketmanager manuell nutzen."; exit 127; fi`;

  const goToolingCommand = `if command -v gopls >/dev/null 2>&1; then echo "[ok] gopls bereits installiert."; else ${aptInstallCommand(
    'golang-go gopls',
  )}; fi`;

  const phpToolingCommand = `if command -v php >/dev/null 2>&1; then npm install -g intelephense; else ${aptInstallCommand(
    'php-cli composer',
  )} && npm install -g intelephense; fi`;

  const dockerToolingCommand = `npm install -g dockerfile-language-server-nodejs && if command -v hadolint >/dev/null 2>&1; then echo "[ok] hadolint bereits installiert."; else ${aptInstallCommand(
    'hadolint',
  )}; fi`;

  const cppToolingCommand = `if command -v gcc >/dev/null 2>&1 && command -v clang >/dev/null 2>&1 && command -v clangd >/dev/null 2>&1 && command -v gdb >/dev/null 2>&1; then echo "[ok] C/C++ Toolchain bereits installiert."; else ${aptInstallCommand(
    'build-essential gdb cmake clang clangd',
  )}; fi`;

  const extensionPresets = [
    {
      id: 'lsp-core-pack',
      label: 'LSP Core Pack',
      command:
        'npm install -g vscode-langservers-extracted yaml-language-server bash-language-server dockerfile-language-server-nodejs sql-language-server intelephense @tailwindcss/language-server',
      note: 'Installiert HTML/CSS/JSON/YAML/Bash/Dockerfile/SQL/PHP/Tailwind-Sprachserver.',
    },
    {
      id: 'cpp-toolchain',
      label: 'C/C++ Toolchain',
      command: cppToolingCommand,
      note: 'Compiler, Debugger und Build-Tools fuer C/C++ (ohne harte sudo-Pflicht).',
    },
    {
      id: 'python-dev',
      label: 'Python Dev Stack',
      command: 'python3 -m pip install --user debugpy ipython pytest black mypy ruff',
      note: 'Debugging, Testing und Formatierung für Python.',
    },
    {
      id: 'node-dev',
      label: 'Node/TS Tooling',
      command: 'npm install --save-dev typescript ts-node eslint prettier @types/node',
      note: 'TypeScript, Linting und Formatierung für JS/TS.',
    },
    {
      id: 'web-lint',
      label: 'Web Lint/Format',
      command: 'npm install --save-dev stylelint stylelint-config-standard htmlhint prettier',
      note: 'Linting für HTML/CSS und einheitliche Formatierung.',
    },
    {
      id: 'go-dev',
      label: 'Go Tooling',
      command: goToolingCommand,
      note: 'Installiert Go + gopls Language Server (oder erkennt vorhandene Installation).',
    },
    {
      id: 'rust-dev',
      label: 'Rust Tooling',
      command: 'curl https://sh.rustup.rs -sSf | sh -s -- -y && ~/.cargo/bin/rustup component add rust-analyzer',
      note: 'Installiert Rust Toolchain inklusive rust-analyzer.',
    },
    {
      id: 'lua-dev',
      label: 'Lua Tooling',
      command: aptInstallCommand('lua5.4 luarocks lua-language-server'),
      note: 'Installiert Lua Runtime und Language Server (falls apt verfuegbar).',
    },
    {
      id: 'java-dev',
      label: 'Java Tooling',
      command: aptInstallCommand('openjdk-17-jdk-headless maven gradle'),
      note: 'Installiert Java Build-Stack. Fuer LSP kann anschliessend jdtls installiert werden.',
    },
    {
      id: 'dotnet-dev',
      label: '.NET Tooling',
      command: 'curl -sSL https://dot.net/v1/dotnet-install.sh | bash -s -- --channel 8.0',
      note: 'Installiert das aktuelle .NET SDK im Workspace.',
    },
    {
      id: 'php-dev',
      label: 'PHP Tooling',
      command: phpToolingCommand,
      note: 'Installiert PHP CLI, Composer und Intelephense ohne harte sudo-Annahme.',
    },
    {
      id: 'docker-tools',
      label: 'Container Tools',
      command: dockerToolingCommand,
      note: 'Dockerfile-Intelligence und Dockerfile-Linting mit apt-Check fuer hadolint.',
    },
  ];

  let sidebarBody: React.ReactNode = null;
  if (activeView === 'explorer') {
    sidebarBody = (
      <ExplorerPanel
        files={files}
        currentPath={explorerPath}
        onOpenPath={(path) => void openPath(path)}
        onRefresh={() => void loadDir(explorerPath)}
        onCreateFile={(target) =>
          void ideApi.files
            .create(workspaceId, target, 'file')
            .then(() => loadDir(explorerPath))
            .catch((e) => appendOutput(`[error] ${e.message}\n`))
        }
        onCreateFolder={(target) =>
          void ideApi.files
            .create(workspaceId, target, 'directory')
            .then(() => loadDir(explorerPath))
            .catch((e) => appendOutput(`[error] ${e.message}\n`))
        }
        onSaveActive={() => void saveActive()}
        onRenamePath={(path) => void renamePath(path)}
        onMovePath={(path) => void movePath(path)}
        onDeletePath={(path) => void deletePath(path)}
      />
    );
  }

  if (activeView === 'search') {
    sidebarBody = (
      <SearchPanel
        workspaceId={workspaceId}
        onOpenMatch={(path, line, column) => {
          void openPath(path, { line, column });
        }}
      />
    );
  }

  if (activeView === 'source-control') {
    sidebarBody = (
      <SourceControlPanel
        statusOutput={gitStatusRaw}
        diffOutput={gitDiffRaw}
        onRefresh={() => void refreshGit()}
        onInitRepo={() => void ideApi.git.init(workspaceId).then(refreshGit)}
        onCloneRepo={(url, branch) => void ideApi.git.clone(workspaceId, url, branch).then(refreshGit)}
        onStage={(path) => void ideApi.git.stage(workspaceId, path).then(refreshGit)}
        onUnstage={(path) => void ideApi.git.unstage(workspaceId, path).then(refreshGit)}
        onCommit={(message) => void ideApi.git.commit(workspaceId, message).then(refreshGit)}
        onPull={() => void ideApi.git.pull(workspaceId).then((out) => appendOutput(out)).then(refreshGit)}
        onPush={() => void ideApi.git.push(workspaceId).then((out) => appendOutput(out)).then(refreshGit)}
      />
    );
  }

  if (activeView === 'run') {
    sidebarBody = (
      <RunPanel
        onRunTask={(task, command) => void runTask(task, command)}
        onTogglePreview={() => setPreviewVisible(!previewVisible)}
        previewVisible={previewVisible}
        previewPort={previewPort}
        onPreviewPortChange={(port) => setPreviewPort(port)}
      />
    );
  }

  if (activeView === 'debug') {
    sidebarBody = (
      <div className="panel-content">
        <div style={{ marginBottom: 10, color: '#b5b5b5', fontSize: 12 }}>
          Aktive Datei: <strong style={{ color: '#e5e5e5' }}>{activeFile?.path || 'keine Datei ausgewählt'}</strong>
        </div>

        <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
          {debugPresets.map((preset) => (
            <div key={preset.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, background: '#1f1f1f' }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <strong style={{ fontSize: 12 }}>{preset.label}</strong>
                <button
                  className="btn"
                  disabled={!preset.enabled || !preset.command}
                  onClick={() => {
                    if (!preset.enabled || !preset.command) return;
                    void runTask('custom', preset.command);
                  }}
                >
                  Starten
                </button>
              </div>
              <div style={{ color: '#9f9f9f', fontSize: 12, marginBottom: 6 }}>{preset.note}</div>
              <code style={{ display: 'block', whiteSpace: 'pre-wrap', color: '#9fd8ff', fontSize: 11 }}>{preset.command || '-'}</code>
            </div>
          ))}
        </div>

        <div className="row" style={{ marginBottom: 8 }}>
          <input
            className="input"
            value={debugCommand}
            onChange={(event) => setDebugCommand(event.target.value)}
            placeholder="Eigener Debug-Befehl (z. B. node --inspect-brk app.js)"
            style={{ flex: 1 }}
          />
          <button
            className="btn"
            onClick={() => {
              if (!debugCommand.trim()) return;
              void runTask('custom', debugCommand.trim());
            }}
          >
            Ausführen
          </button>
        </div>

        <div className="row">
          <button className="btn" onClick={() => setBottomPanel('terminal')}>
            Terminal öffnen
          </button>
          <button className="btn" onClick={() => setBottomPanel('output')}>
            Ausgabe öffnen
          </button>
        </div>
      </div>
    );
  }

  if (activeView === 'extensions') {
    sidebarBody = (
      <div className="panel-content">
        <p className="ide-extensions-hint">
          Diese IDE nutzt Monaco + LSP. VS-Code-Marketplace-Extensions (UI/Extension-Host) laufen hier nicht 1:1. Sie koennen aber praktisch alle
          Compiler, Debugger, Linter und Language-Server direkt im Workspace installieren.
        </p>

        <div className="ide-preset-grid">
          {extensionPresets.map((preset) => (
            <div key={preset.id} className="ide-preset-card">
              <div className="ide-preset-card-head">
                <strong className="ide-preset-card-title">{preset.label}</strong>
                <button className="btn" onClick={() => void runTask('custom', preset.command)}>
                  Installieren
                </button>
              </div>
              <div className="ide-preset-card-note">{preset.note}</div>
              <code className="ide-preset-card-command">{preset.command}</code>
            </div>
          ))}
        </div>

        <div className="row" style={{ marginBottom: 8 }}>
          <input
            className="input"
            value={extensionCommand}
            onChange={(event) => setExtensionCommand(event.target.value)}
            placeholder="Eigener Install-/Setup-Befehl"
            style={{ flex: 1 }}
          />
          <button
            className="btn"
            onClick={() => {
              if (!extensionCommand.trim()) return;
              void runTask('custom', extensionCommand.trim());
            }}
          >
            Ausführen
          </button>
        </div>

        <p style={{ color: '#8a8a8a', fontSize: 12, marginBottom: 0 }}>
          Hinweis: Manche Installationen benötigen Netzwerkzugriff oder Root-Rechte im Runner-Container.
        </p>
      </div>
    );
  }

  if (!token) return null;

  const viewLabel: Record<ActivityView, string> = {
    explorer: 'Dateien',
    search: 'Suche',
    'source-control': 'Quellkontrolle',
    run: 'Ausführen',
    debug: 'Debug',
    extensions: 'Erweiterungen',
  };

  return (
    <div className="ide-root">
      <div className="app-shell">
        <ActivityBar active={activeView} onChange={setActiveView} />

        <section className="sidebar">
          <header className="sidebar-header">{viewLabel[activeView]}</header>
          {sidebarBody}
        </section>

        <main className={`main ${previewVisible ? '' : 'single'}`}>
          <section className="editor-pane">
            <EditorTabs
              files={openFiles}
              activePath={activeFilePath}
              onSelect={setActiveFile}
              onClose={(path) => closeFile(path)}
            />
            <div className="editor-toolbar">
              <div className="row">{activeFile?.path || '(keine Datei geöffnet)'}</div>
              <div className="row">
                <Link className="btn" to="/app/files" title="Zurück zur Cloud">
                  <House size={14} />
                </Link>
                <button className="btn" onClick={() => navigate('/dev/workspaces')}>
                  Arbeitsbereiche
                </button>
                <button className="btn primary" onClick={() => void runActiveFile()} title="Aktive Datei ausführen">
                  <Play size={14} />
                </button>
                <button className="btn" onClick={() => void saveActive()}>
                  Speichern
                </button>
                <button className="btn" onClick={() => setPreviewVisible(!previewVisible)}>
                  {previewVisible ? 'Vorschau ausblenden' : 'Vorschau anzeigen'}
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setPaletteOpen(false);
                    setFileQuickOpenOpen(true);
                  }}
                  title="Datei öffnen (Ctrl/Cmd+P)"
                >
                  Datei öffnen
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setFileQuickOpenOpen(false);
                    setPaletteOpen(true);
                  }}
                  title="Befehle (Ctrl/Cmd+Shift+P)"
                >
                  Befehle
                </button>
              </div>
            </div>
            <EditorPane
              workspaceId={workspaceId}
              activeFile={activeFile}
              onChange={(value) => {
                if (!activeFile) return;
                updateOpenFileContent(activeFile.path, value);
              }}
              token={token}
              onCursorChange={(line, column) => setCursor({ line, column })}
              onProblems={setProblems}
              reveal={reveal}
              onRevealApplied={(id) => {
                setReveal((current) => (current && current.id === id ? null : current));
              }}
            />
          </section>

          {previewVisible && (
            <PreviewPanel
              workspaceId={workspaceId}
              token={token}
              port={previewPort}
              mode={previewMode}
              activeFilePath={activeFile?.path ?? null}
              markdownSource={previewMode === 'markdown' ? activeFile?.content ?? '' : ''}
              onStartPreview={() => runTask('preview')}
              onToggleVisible={() => setPreviewVisible(false)}
              refreshToken={previewRefreshToken}
            />
          )}
        </main>

        <section className="bottom">
          <div className="bottom-tabs">
            <button
              className={`bottom-tab ${bottomPanel === 'terminal' ? 'active' : ''}`}
              onClick={() => setBottomPanel('terminal')}
            >
              Terminal
            </button>
            <button
              className={`bottom-tab ${bottomPanel === 'problems' ? 'active' : ''}`}
              onClick={() => setBottomPanel('problems')}
            >
              Probleme
            </button>
            <button
              className={`bottom-tab ${bottomPanel === 'output' ? 'active' : ''}`}
              onClick={() => setBottomPanel('output')}
            >
              Ausgabe
            </button>
          </div>

          <div className="bottom-content">
            {bottomPanel === 'terminal' && <TerminalPanel workspaceId={workspaceId} token={token} />}
            {bottomPanel === 'problems' &&
              (problems.length ? (
                <div className="problems-list">
                  {problems.map((entry, idx) => {
                    const withPath = /^(.+?):(\d+):(\d+)\s(.*)$/.exec(entry);
                    const withoutPath = /^(\d+):(\d+)\s(.*)$/.exec(entry);
                    const path = withPath?.[1] ?? activeFile?.path ?? '';
                    const line = withPath ? Number(withPath[2]) : withoutPath ? Number(withoutPath[1]) : 1;
                    const column = withPath ? Number(withPath[3]) : withoutPath ? Number(withoutPath[2]) : 1;
                    const message = withPath ? withPath[4] : withoutPath ? withoutPath[3] : entry;
                    const canOpen = Boolean(path);

                    return (
                      <button
                        key={`${path}:${line}:${column}:${idx}`}
                        type="button"
                        className="problem-item"
                        disabled={!canOpen}
                        onClick={() => {
                          if (!canOpen) return;
                          void openPath(path, { line, column });
                          setBottomPanel('problems');
                        }}
                        title={canOpen ? `${path}:${line}:${column}` : message}
                      >
                        <div className="problem-item-head">
                          <span className="problem-item-path">{path || 'Problem'}</span>
                          <span className="problem-item-loc">
                            {line}:{column}
                          </span>
                        </div>
                        <div className="problem-item-msg">{message}</div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                'Keine Diagnosen'
              ))}
            {bottomPanel === 'output' && (outputLines.length ? outputLines.join('') : 'Keine Task-Ausgabe')}
          </div>
        </section>

        <StatusBar
          branch={branch}
          language={activeLanguage}
          cursor={cursor}
          workspaceName={currentWorkspace?.name || 'Workspace'}
          runtimeStatus={runtimeStatus}
        />
      </div>

      <FileQuickOpen
        visible={fileQuickOpenOpen}
        workspaceId={workspaceId}
        recentFiles={recentFiles.length ? recentFiles : openFiles.map((f) => f.path)}
        onClose={() => setFileQuickOpenOpen(false)}
        onOpenPath={(path) => void openPath(path)}
      />
      <CommandPalette visible={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commandPaletteItems} />
    </div>
  );
}
