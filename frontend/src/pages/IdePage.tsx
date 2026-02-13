import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { House, Play } from 'lucide-react';
import { Link } from 'react-router-dom';

import { ActivityBar, type ActivityView } from '../components/ActivityBar';
import { CommandPalette } from '../components/CommandPalette';
import { EditorPane } from '../components/EditorPane';
import { EditorTabs } from '../components/EditorTabs';
import { ExplorerPanel } from '../components/ExplorerPanel';
import { PreviewPanel } from '../components/PreviewPanel';
import { RunPanel } from '../components/RunPanel';
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
  const [gitDiffRaw, setGitDiffRaw] = useState('');
  const [searchText, setSearchText] = useState('');
  const [previewRefreshToken, setPreviewRefreshToken] = useState(0);
  const previewReloadTimerRef = useRef<number | null>(null);
  const previewAutosaveTimerRef = useRef<number | null>(null);

  const activeFile = useMemo(
    () => openFiles.find((item) => item.path === activeFilePath) ?? null,
    [openFiles, activeFilePath],
  );

  const activeLanguage = useMemo(() => {
    if (!activeFile) return 'plaintext';
    const ext = activeFile.path.split('.').at(-1)?.toLowerCase() || '';
    if (['ts', 'tsx'].includes(ext)) return 'typescript';
    if (['js', 'jsx'].includes(ext)) return 'javascript';
    if (ext === 'py') return 'python';
    if (['c', 'h'].includes(ext)) return 'c';
    return ext || 'plaintext';
  }, [activeFile]);

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

  async function openPath(path: string): Promise<void> {
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
      if (!previewVisible) return;
      try {
        const payload = JSON.parse(String(event.data)) as { event?: string };
        if (!payload.event) return;
      } catch {
        return;
      }
      queuePreviewRefresh();
    };

    return () => ws.close();
  }, [workspaceId, explorerPath, token, previewVisible]);

  useEffect(() => {
    if (!previewVisible || !token || !activeFile || !activeFile.dirty) {
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
  }, [previewVisible, token, workspaceId, activeFile, markClean]);

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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setPaletteOpen(true);
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveActive();
      }

      if (event.key === 'Escape') {
        setPaletteOpen(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeFile, workspaceSettings]);

  const commandPaletteItems = useMemo(
    () => [
      { id: 'files.refresh', title: 'Dateien: Aktualisieren', run: () => void loadDir(explorerPath) },
      { id: 'file.save', title: 'Datei: Aktive Datei speichern', run: () => void saveActive() },
      { id: 'git.refresh', title: 'Git: Status aktualisieren', run: () => void refreshGit() },
      { id: 'task.run', title: 'Tasks: Starten', run: () => void runTask('run') },
      { id: 'task.build', title: 'Tasks: Build', run: () => void runTask('build') },
      { id: 'preview.toggle', title: 'Ansicht: Vorschau umschalten', run: () => setPreviewVisible(!previewVisible) },
    ],
    [explorerPath, previewVisible, workspaceSettings, activeFile],
  );

  const branch = gitStatusRaw.split('\n')[0]?.trim() || 'git';

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
      <div className="panel-content">
        <input
          className="input"
          placeholder="In geöffneten Dateien suchen"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          style={{ width: '100%', marginBottom: 8 }}
        />
        {openFiles
          .filter((file) => !searchText || file.content.toLowerCase().includes(searchText.toLowerCase()))
          .map((file) => (
            <button className="workspace-item" key={file.path} onClick={() => setActiveFile(file.path)}>
              {file.path}
            </button>
          ))}
      </div>
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

  if (activeView === 'extensions') {
    sidebarBody = (
      <div className="panel-content">
        <p style={{ color: '#9f9f9f' }}>
          Der Erweiterungsbereich ist in dieser Version vorbereitet. Zusätzliche Sprachserver können über Backend-LSP-Adapter angebunden werden.
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
                <button className="btn" onClick={() => setPaletteOpen(true)}>
                  Cmd/Ctrl+P
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
            />
          </section>

          {previewVisible && (
            <PreviewPanel
              workspaceId={workspaceId}
              token={token}
              port={previewPort}
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
            {bottomPanel === 'problems' && (problems.length ? problems.join('\n') : 'Keine Diagnosen')}
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

      <CommandPalette visible={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commandPaletteItems} />
    </div>
  );
}
