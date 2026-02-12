import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

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
  const [runtimeStatus, setRuntimeStatus] = useState('runner: unknown');
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [gitDiffRaw, setGitDiffRaw] = useState('');
  const [searchText, setSearchText] = useState('');
  const taskWsRef = useRef<WebSocket | null>(null);

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
      setRuntimeStatus(details.runtime.running ? 'runner: active' : 'runner: stopped');
      setPreviewPort(details.settings.previewPort || 3000);

      await ideApi.workspace.start(workspaceId);
      setRuntimeStatus('runner: active');

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
    const items = await ideApi.files.list(workspaceId, targetPath);
    setExplorerPath(targetPath);
    setFiles(items);
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

    const content = await ideApi.files.read(workspaceId, path);
    openFile({
      path,
      content,
      language: activeLanguage,
      dirty: false,
    });
  }

  async function saveActive(): Promise<void> {
    if (!activeFile) return;
    await ideApi.files.write(workspaceId, activeFile.path, activeFile.content);
    markClean(activeFile.path);
    appendOutput(`[save] ${activeFile.path}`);
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

    setBottomPanel('output');
    appendOutput(`$ ${task === 'custom' ? command : task}`);

    taskWsRef.current?.close();
    const wsBase = ideApiBaseUrl().replace(/^http/, 'ws');
    const ws = new WebSocket(`${wsBase}/ws/tasks?workspaceId=${encodeURIComponent(workspaceId)}&token=${encodeURIComponent(token)}`);
    taskWsRef.current = ws;

    ws.onopen = () => {
      const effective = task === 'custom' ? command || '' : workspaceSettings?.commands[task === 'preview' ? 'preview' : task] || '';
      ws.send(JSON.stringify({ type: 'run', cmd: effective, env: workspaceSettings?.env || {} }));
    };

    ws.onmessage = (event) => {
      const payload = JSON.parse(String(event.data)) as { type: string; data?: string; code?: number };
      if ((payload.type === 'stdout' || payload.type === 'stderr') && payload.data) {
        appendOutput(payload.data);
      }
      if (payload.type === 'exit') {
        appendOutput(`\n[exit ${payload.code}]`);
      }
    };

    ws.onerror = () => appendOutput('[error] task stream failed');
  }

  useEffect(() => {
    void loadWorkspace();

    return () => {
      taskWsRef.current?.close();
    };
  }, [workspaceId]);

  useEffect(() => {
    const wsBase = ideApiBaseUrl().replace(/^http/, 'ws');
    if (!token) return;
    const ws = new WebSocket(`${wsBase}/ws/files?workspaceId=${encodeURIComponent(workspaceId)}&token=${encodeURIComponent(token)}`);

    ws.onmessage = () => {
      void loadDir(explorerPath);
    };

    return () => ws.close();
  }, [workspaceId, explorerPath, token]);

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
      { id: 'files.refresh', title: 'Explorer: Refresh', run: () => void loadDir(explorerPath) },
      { id: 'file.save', title: 'File: Save Active File', run: () => void saveActive() },
      { id: 'git.refresh', title: 'Git: Refresh Status', run: () => void refreshGit() },
      { id: 'task.run', title: 'Tasks: Run', run: () => void runTask('run') },
      { id: 'task.build', title: 'Tasks: Build', run: () => void runTask('build') },
      { id: 'preview.toggle', title: 'View: Toggle Preview', run: () => setPreviewVisible(!previewVisible) },
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
            .catch((e) => appendOutput(e.message))
        }
        onCreateFolder={(target) =>
          void ideApi.files
            .create(workspaceId, target, 'directory')
            .then(() => loadDir(explorerPath))
            .catch((e) => appendOutput(e.message))
        }
        onSaveActive={() => void saveActive()}
      />
    );
  }

  if (activeView === 'search') {
    sidebarBody = (
      <div className="panel-content">
        <input
          className="input"
          placeholder="search in open files"
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
          Extension marketplace is a stub in MVP. Use backend LSP adapters to add additional language servers.
        </p>
      </div>
    );
  }

  if (!token) return null;

  return (
    <div className="ide-root">
      <div className="app-shell">
        <ActivityBar active={activeView} onChange={setActiveView} />

        <section className="sidebar">
          <header className="sidebar-header">{activeView.replace('-', ' ')}</header>
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
              <div className="row">{activeFile?.path || '(no file opened)'}</div>
              <div className="row">
                <button className="btn" onClick={() => void saveActive()}>
                  Save
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

          {previewVisible && <PreviewPanel workspaceId={workspaceId} token={token} port={previewPort} />}
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
              Problems
            </button>
            <button
              className={`bottom-tab ${bottomPanel === 'output' ? 'active' : ''}`}
              onClick={() => setBottomPanel('output')}
            >
              Output
            </button>
          </div>

          <div className="bottom-content">
            {bottomPanel === 'terminal' && <TerminalPanel workspaceId={workspaceId} token={token} />}
            {bottomPanel === 'problems' && (problems.length ? problems.join('\n') : 'No diagnostics')}
            {bottomPanel === 'output' && (outputLines.length ? outputLines.join('') : 'No task output')}
          </div>
        </section>

        <StatusBar
          branch={branch}
          language={activeLanguage}
          cursor={cursor}
          workspaceName={currentWorkspace?.name || 'workspace'}
          runtimeStatus={runtimeStatus}
        />
      </div>

      <CommandPalette visible={paletteOpen} onClose={() => setPaletteOpen(false)} commands={commandPaletteItems} />
    </div>
  );
}
