import {
  FolderOpen,
  History,
  Share2,
  Search,
  Settings,
  Shield,
} from 'lucide-react';
import { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import Dock from '@/components/reactbits/Dock';
import { useCurrentUser } from '@/hooks/useCurrentUser';

export function DockNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: user } = useCurrentUser();

  const items = useMemo(() => {
    const base = [
      { label: 'Files', path: '/app/files', icon: <FolderOpen size={18} /> },
      { label: 'Recents', path: '/app/recents', icon: <History size={18} /> },
      { label: 'Shared', path: '/app/shared', icon: <Share2 size={18} /> },
      { label: 'Search', path: '/app/search', icon: <Search size={18} /> },
      { label: 'Settings', path: '/app/settings', icon: <Settings size={18} /> },
    ];

    const isAdmin = user?.roles.some((role) => role.name === 'admin');
    if (isAdmin) {
      base.push({ label: 'Admin', path: '/app/admin', icon: <Shield size={18} /> });
    }

    return base.map((item) => ({
      ...item,
      className: location.pathname === item.path ? 'active' : '',
      onClick: () => navigate(item.path),
    }));
  }, [location.pathname, navigate, user?.roles]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-1 z-50 flex justify-center">
      <div className="pointer-events-auto">
        <Dock items={items} panelHeight={62} baseItemSize={48} magnification={68} />
      </div>
    </div>
  );
}
