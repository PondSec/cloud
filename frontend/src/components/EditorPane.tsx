import { useEffect, useMemo, useRef } from 'react';
import Editor, { type Monaco } from '@monaco-editor/react';
import type * as monacoEditor from 'monaco-editor';

import { LspClient } from '../lib/lsp-client';
import type { OpenFile } from '../state/ide-store';

interface EditorPaneProps {
  workspaceId: string;
  activeFile: OpenFile | null;
  onChange: (value: string) => void;
  token: string;
  onCursorChange: (line: number, column: number) => void;
  onProblems: (items: string[]) => void;
}

const languageByExt: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  py: 'python',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  go: 'go',
  rs: 'rust',
  java: 'java',
  php: 'php',
  lua: 'lua',
  json: 'json',
  jsonc: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  dockerfile: 'dockerfile',
  sql: 'sql',
  md: 'markdown',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
};

const lspEnabledLanguages = new Set([
  'typescript',
  'javascript',
  'python',
  'c',
  'cpp',
  'html',
  'css',
  'json',
  'yaml',
  'bash',
  'dockerfile',
  'php',
  'sql',
  'go',
  'rust',
  'lua',
  'java',
]);

const markerSeverity = {
  1: 8,
  2: 4,
  3: 2,
  4: 1,
} as const;

const htmlSnippets: Array<{ label: string; insertText: string; detail: string }> = [
  {
    label: '!doctype',
    insertText:
      '<!doctype html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8" />\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0" />\n\t<title>${1:Document}</title>\n</head>\n<body>\n\t${0}\n</body>\n</html>',
    detail: 'HTML-Grundgerüst',
  },
  {
    label: 'script',
    insertText: '<script src="${1:app.js}"></script>',
    detail: 'Script-Tag',
  },
  {
    label: 'link:css',
    insertText: '<link rel="stylesheet" href="${1:styles.css}" />',
    detail: 'Stylesheet-Link',
  },
  {
    label: 'div.class',
    insertText: '<div class="${1:container}">\n\t${0}\n</div>',
    detail: 'Div mit Klasse',
  },
];

const markdownSnippets: Array<{ label: string; insertText: string; detail: string }> = [
  { label: '# heading', insertText: '# ${1:Titel}', detail: 'Überschrift 1' },
  { label: '## heading', insertText: '## ${1:Untertitel}', detail: 'Überschrift 2' },
  { label: 'code fence', insertText: '```$1\n$0\n```', detail: 'Codeblock' },
  { label: 'table', insertText: '| ${1:Spalte} | ${2:Spalte} |\n| --- | --- |\n| ${3:Wert} | ${4:Wert} |', detail: 'Markdown-Tabelle' },
];

const voidHtmlTags = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

export function EditorPane({ workspaceId, activeFile, onChange, token, onCursorChange, onProblems }: EditorPaneProps) {
  const monacoRef = useRef<Monaco | null>(null);
  const editorRef = useRef<monacoEditor.editor.IStandaloneCodeEditor | null>(null);
  const lspClients = useRef(new Map<string, LspClient>());
  const currentVersion = useRef(new Map<string, number>());

  const language = useMemo(() => {
    if (!activeFile) return 'plaintext';
    const ext = activeFile.path.split('.').at(-1)?.toLowerCase() || '';
    if (!ext && activeFile.path.toLowerCase() === 'dockerfile') {
      return 'dockerfile';
    }
    return languageByExt[ext] || 'plaintext';
  }, [activeFile]);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;

    const disposables: monacoEditor.IDisposable[] = [];
    const languages = [
      'typescript',
      'javascript',
      'python',
      'c',
      'cpp',
      'html',
      'css',
      'json',
      'yaml',
      'bash',
      'dockerfile',
      'php',
      'sql',
      'go',
      'rust',
      'lua',
      'java',
    ] as const;

    for (const lang of languages) {
      disposables.push(
        monaco.languages.registerCompletionItemProvider(lang, {
          triggerCharacters: ['.', ':', '>'],
          provideCompletionItems: async (model, position) => {
            const client = lspClients.current.get(lang);
            if (!client) return { suggestions: [] };
            const items = await client.requestCompletion(model.uri.toString(), position as any);

            return {
              suggestions: items.map((item: any) => ({
                label: item.label,
                insertText: item.insertText || item.label,
                kind: monaco.languages.CompletionItemKind.Text,
                detail: item.detail,
                documentation: typeof item.documentation === 'string' ? item.documentation : item.documentation?.value,
                range: {
                  startLineNumber: position.lineNumber,
                  startColumn: position.column,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                },
              })),
            };
          },
        }),
      );

      disposables.push(
        monaco.languages.registerDefinitionProvider(lang, {
          provideDefinition: async (model, position) => {
            const client = lspClients.current.get(lang);
            if (!client) return [];
            const result = await client.requestDefinition(model.uri.toString(), position as any);
            const arr = Array.isArray(result) ? result : result ? [result] : [];

            return arr.map((item: any) => ({
              uri: monaco.Uri.parse(item.uri),
              range: {
                startLineNumber: item.range.start.line + 1,
                startColumn: item.range.start.character + 1,
                endLineNumber: item.range.end.line + 1,
                endColumn: item.range.end.character + 1,
              },
            }));
          },
        }),
      );

      disposables.push(
        monaco.languages.registerRenameProvider(lang, {
          provideRenameEdits: async (model, position, newName) => {
            const client = lspClients.current.get(lang);
            if (!client) return null;
            const result = await client.requestRename(model.uri.toString(), position as any, newName);
            if (!result?.changes) return null;

            const edits: monacoEditor.languages.IWorkspaceTextEdit[] = [];
            for (const [uri, uriEdits] of Object.entries(result.changes)) {
              const firstEdit = (uriEdits as any[])[0];
              if (!firstEdit) {
                continue;
              }
              edits.push({
                resource: monaco.Uri.parse(uri),
                textEdit: {
                  range: {
                    startLineNumber: firstEdit.range.start.line + 1,
                    startColumn: firstEdit.range.start.character + 1,
                    endLineNumber: firstEdit.range.end.line + 1,
                    endColumn: firstEdit.range.end.character + 1,
                  },
                  text: firstEdit.newText,
                },
                versionId: undefined,
              });
            }

            return { edits };
          },
          resolveRenameLocation: async (_model, _position) => ({
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: 1,
              endColumn: 1,
            },
            text: '',
          }),
        }) as any,
      );

      disposables.push(
        monaco.languages.registerDocumentFormattingEditProvider(lang, {
          provideDocumentFormattingEdits: async (model) => {
            const client = lspClients.current.get(lang);
            if (!client) return [];
            const edits = await client.requestFormatting(model.uri.toString());
            if (!edits) return [];

            return edits.map((edit: any) => ({
              range: {
                startLineNumber: edit.range.start.line + 1,
                startColumn: edit.range.start.character + 1,
                endLineNumber: edit.range.end.line + 1,
                endColumn: edit.range.end.character + 1,
              },
              text: edit.newText,
            }));
          },
        }),
      );
    }

    disposables.push(
      monaco.languages.registerCompletionItemProvider('html', {
        triggerCharacters: ['<', '/', '.', ':'],
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          return {
            suggestions: htmlSnippets.map((snippet) => ({
              label: snippet.label,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: snippet.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: snippet.detail,
              range,
            })),
          };
        },
      }),
    );

    disposables.push(
      monaco.languages.registerCompletionItemProvider('markdown', {
        triggerCharacters: ['#', '|', '`'],
        provideCompletionItems: (model, position) => {
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };

          return {
            suggestions: markdownSnippets.map((snippet) => ({
              label: snippet.label,
              kind: monaco.languages.CompletionItemKind.Snippet,
              insertText: snippet.insertText,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: snippet.detail,
              range,
            })),
          };
        },
      }),
    );

    return () => {
      for (const d of disposables) d.dispose();
    };
  }, []);

  useEffect(() => {
    if (!activeFile || !lspEnabledLanguages.has(language)) {
      return;
    }

    const lang = language as
      | 'typescript'
      | 'javascript'
      | 'python'
      | 'c'
      | 'cpp'
      | 'html'
      | 'css'
      | 'json'
      | 'yaml'
      | 'bash'
      | 'dockerfile'
      | 'php'
      | 'sql'
      | 'go'
      | 'rust'
      | 'lua'
      | 'java';
    let client = lspClients.current.get(lang);
    if (!client) {
      client = new LspClient({ workspaceId, language: lang, token });
      client.onDiagnostics((params) => {
        const monaco = monacoRef.current;
        if (!monaco) return;
        const uri = monaco.Uri.parse(params.uri);
        const markers = (params.diagnostics || []).map((diag: any) => ({
          startLineNumber: diag.range.start.line + 1,
          startColumn: diag.range.start.character + 1,
          endLineNumber: diag.range.end.line + 1,
          endColumn: diag.range.end.character + 1,
          message: diag.message,
          severity: markerSeverity[(diag.severity || 2) as keyof typeof markerSeverity] || monaco.MarkerSeverity.Warning,
        }));
        const model = monaco.editor.getModel(uri);
        if (!model) {
          return;
        }
        monaco.editor.setModelMarkers(model, `lsp-${lang}`, markers);
        onProblems(markers.map((m: any) => `${m.startLineNumber}:${m.startColumn} ${m.message}`));
      });
      lspClients.current.set(lang, client);
    }

    const uri = `file:///workspaces/${workspaceId}/${activeFile.path}`;
    currentVersion.current.set(uri, 1);
    void client.didOpen(uri, lang, activeFile.content);
  }, [activeFile?.path, workspaceId, language, token]);

  useEffect(() => {
    if (!activeFile || !lspEnabledLanguages.has(language)) {
      return;
    }

    const client = lspClients.current.get(language as any);
    if (!client) return;

    const uri = `file:///workspaces/${workspaceId}/${activeFile.path}`;
    const version = (currentVersion.current.get(uri) || 1) + 1;
    currentVersion.current.set(uri, version);

    const timer = window.setTimeout(() => {
      void client.didChange(uri, version, activeFile.content);
    }, 250);

    return () => window.clearTimeout(timer);
  }, [activeFile?.content, activeFile?.path, workspaceId, language]);

  useEffect(() => {
    return () => {
      for (const client of lspClients.current.values()) {
        client.dispose();
      }
      lspClients.current.clear();
    };
  }, []);

  const modelPath = activeFile ? `file:///workspaces/${workspaceId}/${activeFile.path}` : undefined;

  return (
    <div className="editor-mount">
      <Editor
        key={modelPath ?? 'empty'}
        path={modelPath}
        value={activeFile?.content ?? ''}
        language={language}
        theme="vs-dark"
        options={{
          minimap: { enabled: true },
          fontSize: 13,
          automaticLayout: true,
          smoothScrolling: true,
          scrollBeyondLastLine: false,
          autoClosingBrackets: 'always',
          autoClosingQuotes: 'always',
          autoClosingDelete: 'always',
          autoClosingOvertype: 'always',
          autoSurround: 'languageDefined',
          linkedEditing: true,
          bracketPairColorization: { enabled: true },
          guides: {
            bracketPairs: true,
            highlightActiveBracketPair: true,
            indentation: true,
            highlightActiveIndentation: true,
          },
          quickSuggestions: {
            comments: true,
            strings: true,
            other: true,
          },
          suggestOnTriggerCharacters: true,
          tabCompletion: 'on',
          wordBasedSuggestions: 'currentDocument',
          snippetSuggestions: 'inline',
          acceptSuggestionOnEnter: 'on',
          parameterHints: { enabled: true },
          formatOnType: true,
          formatOnPaste: true,
          matchBrackets: 'always',
        }}
        onMount={(editor, monaco) => {
          editorRef.current = editor;
          monacoRef.current = monaco;
          editor.onDidChangeCursorPosition((event) => {
            onCursorChange(event.position.lineNumber, event.position.column);
          });

          editor.onDidChangeModelContent((event) => {
            const model = editor.getModel();
            if (!model || model.getLanguageId() !== 'html' || event.isFlush) {
              return;
            }

            const change = event.changes.at(-1);
            if (!change || change.text !== '>' || change.rangeLength !== 0) {
              return;
            }

            const lineNumber = change.range.startLineNumber;
            const columnAfter = change.range.startColumn + change.text.length;
            const line = model.getLineContent(lineNumber);
            const prefix = line.slice(0, columnAfter - 1);
            const suffix = line.slice(columnAfter - 1);
            const match = prefix.match(/<([A-Za-z][\w:-]*)(?:\s[^<>]*)?>$/);
            if (!match) {
              return;
            }

            const tag = (match[1] || '').toLowerCase();
            if (!tag || voidHtmlTags.has(tag)) {
              return;
            }

            if (new RegExp(`^\\s*</${tag}\\s*>`, 'i').test(suffix)) {
              return;
            }

            editor.executeEdits('html-auto-close', [
              {
                range: new monaco.Range(lineNumber, columnAfter, lineNumber, columnAfter),
                text: `</${tag}>`,
                forceMoveMarkers: true,
              },
            ]);
            editor.setPosition({ lineNumber, column: columnAfter });
          });
        }}
        onChange={(value) => onChange(value ?? '')}
      />
    </div>
  );
}
