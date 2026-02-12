interface StatusBarProps {
  branch: string;
  language: string;
  cursor: { line: number; column: number };
  workspaceName: string;
  runtimeStatus: string;
}

export function StatusBar({ branch, language, cursor, workspaceName, runtimeStatus }: StatusBarProps) {
  return (
    <footer className="status">
      <div className="row">
        <span>{workspaceName}</span>
        <span>{branch}</span>
      </div>
      <div className="row">
        <span>{language}</span>
        <span>
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span>{runtimeStatus}</span>
      </div>
    </footer>
  );
}
