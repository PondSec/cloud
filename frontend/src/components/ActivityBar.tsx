import { Bug, Boxes, FileCode2, GitBranch, Play, Search } from 'lucide-react';
import type { ReactNode } from 'react';

export type ActivityView = 'explorer' | 'search' | 'source-control' | 'run' | 'debug' | 'extensions';

interface ActivityBarProps {
  active: ActivityView;
  onChange: (view: ActivityView) => void;
}

const items: Array<{ id: ActivityView; icon: ReactNode; label: string }> = [
  { id: 'explorer', icon: <FileCode2 size={20} />, label: 'Dateien' },
  { id: 'search', icon: <Search size={20} />, label: 'Suche' },
  { id: 'source-control', icon: <GitBranch size={20} />, label: 'Quellkontrolle' },
  { id: 'run', icon: <Play size={20} />, label: 'Ausführen und Debuggen' },
  { id: 'debug', icon: <Bug size={20} />, label: 'Debug' },
  { id: 'extensions', icon: <Boxes size={20} />, label: 'Erweiterungen' },
];

export function ActivityBar({ active, onChange }: ActivityBarProps) {
  return (
    <aside className="activity-bar" aria-label="Primäre IDE-Seitenleiste">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`activity-btn ${item.id === active ? 'active' : ''}`}
          onClick={() => onChange(item.id)}
          title={item.label}
          aria-label={item.label}
        >
          {item.icon}
        </button>
      ))}
      <div style={{ flex: 1 }} />
    </aside>
  );
}
