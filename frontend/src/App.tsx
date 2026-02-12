import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/components/app/AppShell';
import { RequireAdmin } from '@/components/auth/RequireAdmin';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { RequireIdeAuth } from '@/components/auth/RequireIdeAuth';
import { AdminPage } from '@/pages/AdminPage';
import { FilesPage } from '@/pages/FilesPage';
import { IdePage } from '@/pages/IdePage';
import { LoginPage } from '@/pages/LoginPage';
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
          <Route index element={<Navigate to="/app/files" replace />} />
          <Route path="files" element={<FilesPage />} />
          <Route path="office/:fileId" element={<OfficeEditorPage />} />
          <Route path="recents" element={<RecentsPage />} />
          <Route path="shared" element={<SharedPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route
            path="admin"
            element={
              <RequireAdmin>
                <AdminPage />
              </RequireAdmin>
            }
          />
        </Route>
      </Route>

      <Route element={<RequireIdeAuth />}>
        <Route path="/dev/workspaces" element={<WorkspacesPage />} />
        <Route path="/dev/ide/:workspaceId" element={<IdePage />} />
      </Route>

      <Route path="/dev" element={<Navigate to="/dev/workspaces" replace />} />
      <Route path="/" element={<Navigate to="/app/files" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
