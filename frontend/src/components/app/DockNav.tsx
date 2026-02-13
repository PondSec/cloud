import {
  Activity,
  Code2,
  Image,
  FolderOpen,
  Home,
  History,
  Search,
  Settings,
  Share2,
  Shield,
} from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import Dock from '@/components/reactbits/Dock';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { hasAnyPermission, hasPermission, isAdmin, PERMISSIONS } from '@/lib/permissions';

export function DockNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: user } = useCurrentUser();

  const items = useMemo(() => {
    const base: Array<{ label: string; path: string; icon: ReactNode }> = [];

    base.push({ label: 'Home', path: '/app/home', icon: <Home size={18} /> });

    if (hasPermission(user, PERMISSIONS.FILE_READ)) {
      base.push({ label: 'Files', path: '/app/files', icon: <FolderOpen size={18} /> });
      base.push({ label: 'Recents', path: '/app/recents', icon: <History size={18} /> });
      base.push({ label: 'Search', path: '/app/search', icon: <Search size={18} /> });
    }
    if (hasPermission(user, PERMISSIONS.SHARE_VIEW_RECEIVED)) {
      base.push({ label: 'Shared', path: '/app/shared', icon: <Share2 size={18} /> });
    }
    if (hasPermission(user, PERMISSIONS.FILE_READ) && hasPermission(user, PERMISSIONS.MEDIA_VIEW)) {
      base.push({ label: 'Media', path: '/app/media', icon: <Image size={18} /> });
    }

    base.push({ label: 'Settings', path: '/app/settings', icon: <Settings size={18} /> });

    if (hasPermission(user, PERMISSIONS.IDE_USE)) {
      base.push({ label: 'IDE', path: '/dev/workspaces', icon: <Code2 size={18} /> });
    }

    if (hasAnyPermission(user, [PERMISSIONS.USER_MANAGE, PERMISSIONS.ROLE_MANAGE, PERMISSIONS.SERVER_SETTINGS])) {
      base.push({ label: 'Admin', path: '/app/admin', icon: <Shield size={18} /> });
    }

    if (isAdmin(user)) {
      base.push({ label: 'Monitoring', path: '/app/monitoring', icon: <Activity size={18} /> });
    }

    return base.map((item) => ({
      ...item,
      className:
        item.path === '/dev/workspaces'
          ? location.pathname.startsWith('/dev')
            ? 'active'
            : ''
          : location.pathname === item.path
            ? 'active'
            : '',
      onClick: () => navigate(item.path),
    }));
  }, [location.pathname, navigate, user]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-1 z-50 flex justify-center">
      <div className="pointer-events-auto">
        <Dock items={items} panelHeight={62} baseItemSize={48} magnification={68} />
      </div>
    </div>
  );
}
