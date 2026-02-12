import { Bug, Boxes, FileCode2, GitBranch, Play, Search } from 'lucide-react';
import type { ReactNode } from 'react';

export type ActivityView = 'explorer' | 'search' | 'source-control' | 'run' | 'extensions';

interface ActivityBarProps {
  active: ActivityView;
  onChange: (view: ActivityView) => void;
}

const items: Array<{ id: ActivityView; icon: ReactNode; label: string }> = [
  { id: 'explorer', icon: <FileCode2 size={20} />, label: 'Explorer' },
  { id: 'search', icon: <Search size={20} />, label: 'Search' },
  { id: 'source-control', icon: <GitBranch size={20} />, label: 'Source Control' },
  { id: 'run', icon: <Play size={20} />, label: 'Run and Debug' },
  { id: 'extensions', icon: <Boxes size={20} />, label: 'Extensions' },
];

export function ActivityBar({ active, onChange }: ActivityBarProps) {
  return (
    <aside className="activity-bar" aria-label="Primary IDE sidebar">
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
      <button className="activity-btn" type="button" title="Debug stub" aria-label="Debug stub">
        <Bug size={20} />
      </button>
    </aside>
  );
}
