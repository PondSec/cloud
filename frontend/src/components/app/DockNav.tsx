import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Boxes,
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
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import Dock from '@/components/reactbits/Dock';
import { DEFAULT_DOCK_ORDER, useUiPrefs } from '@/contexts/UiPrefsContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { api } from '@/lib/api';
import { hasAnyPermission, hasPermission, isAdmin, PERMISSIONS } from '@/lib/permissions';
import { cn } from '@/lib/utils';

export function DockNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { data: user } = useCurrentUser();
  const { prefs } = useUiPrefs();
  const inventoryProContextQuery = useQuery({
    queryKey: ['auth', 'inventorypro-context'],
    queryFn: api.auth.inventoryProContext,
    enabled: Boolean(user),
  });
  const inventoryProContext = inventoryProContextQuery.data;

  const items = useMemo(() => {
    const dockOrder = Array.isArray(prefs.dockOrder) && prefs.dockOrder.length > 0 ? prefs.dockOrder : DEFAULT_DOCK_ORDER;
    const orderIndex = new Map<string, number>(dockOrder.map((path, index) => [path, index]));

    const candidates: Array<{
      label: string;
      path: string;
      icon: ReactNode;
      visible: boolean;
      order: number;
    }> = [
      { label: 'Start', path: '/app/home', icon: <Home size={18} />, visible: true, order: 10 },
      {
        label: 'Dateien',
        path: '/app/files',
        icon: <FolderOpen size={18} />,
        visible: hasPermission(user, PERMISSIONS.FILE_READ),
        order: 20,
      },
      {
        label: 'Suche',
        path: '/app/search',
        icon: <Search size={18} />,
        visible: hasPermission(user, PERMISSIONS.FILE_READ),
        order: 30,
      },
      {
        label: 'Zuletzt',
        path: '/app/recents',
        icon: <History size={18} />,
        visible: hasPermission(user, PERMISSIONS.FILE_READ),
        order: 40,
      },
      {
        label: 'Freigaben',
        path: '/app/shared',
        icon: <Share2 size={18} />,
        visible: hasPermission(user, PERMISSIONS.SHARE_VIEW_RECEIVED),
        order: 50,
      },
      {
        label: 'Medien',
        path: '/app/media',
        icon: <Image size={18} />,
        visible: hasPermission(user, PERMISSIONS.FILE_READ) && hasPermission(user, PERMISSIONS.MEDIA_VIEW),
        order: 60,
      },
      {
        label: 'Studio',
        path: '/dev/workspaces',
        icon: <Code2 size={18} />,
        visible: hasPermission(user, PERMISSIONS.IDE_USE),
        order: 70,
      },
      {
        label: 'Verwaltung',
        path: '/app/admin',
        icon: <Shield size={18} />,
        visible: hasAnyPermission(user, [PERMISSIONS.USER_MANAGE, PERMISSIONS.ROLE_MANAGE, PERMISSIONS.SERVER_SETTINGS]),
        order: 80,
      },
      {
        label: 'System',
        path: '/app/monitoring',
        icon: <Activity size={18} />,
        visible: isAdmin(user),
        order: 90,
      },
      { label: 'Einstellungen', path: '/app/settings', icon: <Settings size={18} />, visible: true, order: 100 },
      {
        label: 'Inventory Pro',
        path: '/app/inventorypro',
        icon: <Boxes size={18} />,
        visible: Boolean(inventoryProContext?.available),
        order: 110,
      },
    ];

    const base = candidates
      .filter((item) => item.visible)
      .sort((a, b) => {
        const aRank = orderIndex.get(a.path) ?? a.order;
        const bRank = orderIndex.get(b.path) ?? b.order;
        return aRank - bRank;
      })
      .map((item) => ({
        label: item.label,
        path: item.path,
        icon: item.icon,
      }));

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
      onClick: () => {
        if (item.path === '/app/inventorypro') {
          const launchUrl = inventoryProContext?.launch_url;
          if (launchUrl) {
            window.open(launchUrl, '_blank', 'noopener,noreferrer');
          }
          return;
        }
        navigate(item.path);
      },
    }));
  }, [inventoryProContext?.available, inventoryProContext?.launch_url, location.pathname, navigate, prefs.dockOrder, user]);

  const isVertical = prefs.dockPosition !== 'bottom';
  const wrapperClass = cn(
    'pointer-events-none fixed z-50 flex',
    prefs.dockPosition === 'left' && 'top-1/2 -translate-y-1/2 justify-start',
    prefs.dockPosition === 'right' && 'top-1/2 -translate-y-1/2 justify-end',
    prefs.dockPosition === 'bottom' && 'inset-x-0 justify-center',
  );
  const edgeOffsetStyle = useMemo<CSSProperties>(() => {
    if (prefs.dockPosition === 'left') {
      return { left: `${prefs.dockEdgeOffset}px` };
    }
    if (prefs.dockPosition === 'right') {
      return { right: `${prefs.dockEdgeOffset}px` };
    }
    return { bottom: `${prefs.dockEdgeOffset}px` };
  }, [prefs.dockEdgeOffset, prefs.dockPosition]);
  const dockStyle = useMemo<CSSProperties>(
    () =>
      ({
        '--dock-panel-radius': `${Math.max(12, Math.round(prefs.cornerRadius * 0.75))}px`,
        '--dock-item-radius': `${Math.max(8, Math.round(prefs.cornerRadius * 0.5))}px`,
        '--dock-gap': isVertical ? '0.45rem' : '0.65rem',
        '--dock-panel-padding': isVertical ? '0.45rem' : '0 0.5rem 0.5rem',
        '--cloud-accent-hsl': `${prefs.accentHue} ${prefs.accentSaturation}% ${prefs.accentLightness}%`,
      }) as CSSProperties,
    [isVertical, prefs.accentHue, prefs.accentLightness, prefs.accentSaturation, prefs.cornerRadius],
  );

  return (
    <div className={wrapperClass} style={edgeOffsetStyle}>
      <div className="pointer-events-auto">
        <Dock
          items={items}
          orientation={isVertical ? 'vertical' : 'horizontal'}
          edge={prefs.dockPosition}
          panelHeight={prefs.dockPanelHeight}
          baseItemSize={prefs.dockBaseItemSize}
          magnification={prefs.dockMagnification}
          dockHeight={Math.max(220, prefs.dockMagnification + 110)}
          style={dockStyle}
        />
      </div>
    </div>
  );
}
