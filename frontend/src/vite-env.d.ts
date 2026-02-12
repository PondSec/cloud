/// <reference types="vite/client" />

interface DocsApiEditorInstance {
  destroyEditor?: () => void;
}

interface DocsApiNamespace {
  DocEditor: new (placeholderId: string, config: unknown) => DocsApiEditorInstance;
}

interface Window {
  DocsAPI?: DocsApiNamespace;
}
