import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/components/app/AppShell';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { RequireAdmin } from '@/components/auth/RequireAdmin';
import { RequireIdeAuth } from '@/components/auth/RequireIdeAuth';
import { RequirePermission } from '@/components/auth/RequirePermission';
import { PERMISSIONS } from '@/lib/permissions';
import { AdminPage } from '@/pages/AdminPage';
import { EmailPage } from '@/pages/EmailPage';
import { FilesPage } from '@/pages/FilesPage';
import { HomePage } from '@/pages/HomePage';
import { IdePage } from '@/pages/IdePage';
import { LoginPage } from '@/pages/LoginPage';
import { MediaPage } from '@/pages/MediaPage';
import { MonitoringPage } from '@/pages/MonitoringPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { OfficeEditorPage } from '@/pages/OfficeEditorPage';
import { RecentsPage } from '@/pages/RecentsPage';
import { SearchPage } from '@/pages/SearchPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SharedPage } from '@/pages/SharedPage';
import { WorkspacesPage } from '@/pages/WorkspacesPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Navigate to="/app/home" replace />} />
          <Route path="home" element={<HomePage />} />
          <Route
            path="files"
            element={
              <RequirePermission allOf={[PERMISSIONS.FILE_READ]}>
                <FilesPage />
              </RequirePermission>
            }
          />
          <Route
            path="office/:fileId"
            element={
              <RequirePermission allOf={[PERMISSIONS.OFFICE_USE]}>
                <OfficeEditorPage />
              </RequirePermission>
            }
          />
          <Route
            path="recents"
            element={
              <RequirePermission allOf={[PERMISSIONS.FILE_READ]}>
                <RecentsPage />
              </RequirePermission>
            }
          />
          <Route
            path="shared"
            element={
              <RequirePermission allOf={[PERMISSIONS.SHARE_VIEW_RECEIVED]}>
                <SharedPage />
              </RequirePermission>
            }
          />
          <Route
            path="search"
            element={
              <RequirePermission allOf={[PERMISSIONS.FILE_READ]}>
                <SearchPage />
              </RequirePermission>
            }
          />
          <Route
            path="media"
            element={
              <RequirePermission allOf={[PERMISSIONS.FILE_READ, PERMISSIONS.MEDIA_VIEW]}>
                <MediaPage />
              </RequirePermission>
            }
          />
          <Route path="email" element={<EmailPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="admin"
            element={
              <RequirePermission anyOf={[PERMISSIONS.USER_MANAGE, PERMISSIONS.ROLE_MANAGE, PERMISSIONS.SERVER_SETTINGS]}>
                <AdminPage />
              </RequirePermission>
            }
          />
          <Route
            path="monitoring"
            element={
              <RequireAdmin>
                <MonitoringPage />
              </RequireAdmin>
            }
          />
        </Route>
      </Route>

      <Route element={<RequireIdeAuth />}>
        <Route
          path="/dev/workspaces"
          element={
            <RequirePermission allOf={[PERMISSIONS.IDE_USE]} fallbackTo="/app/files">
              <WorkspacesPage />
            </RequirePermission>
          }
        />
        <Route
          path="/dev/ide/:workspaceId"
          element={
            <RequirePermission allOf={[PERMISSIONS.IDE_USE]} fallbackTo="/app/files">
              <IdePage />
            </RequirePermission>
          }
        />
      </Route>

      <Route path="/dev" element={<Navigate to="/dev/workspaces" replace />} />
      <Route path="/" element={<Navigate to="/app/home" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
