import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/components/app/AppShell';
import { RequireAdmin } from '@/components/auth/RequireAdmin';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { AdminPage } from '@/pages/AdminPage';
import { FilesPage } from '@/pages/FilesPage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { RecentsPage } from '@/pages/RecentsPage';
import { SearchPage } from '@/pages/SearchPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SharedPage } from '@/pages/SharedPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth />}>
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Navigate to="/app/files" replace />} />
          <Route path="files" element={<FilesPage />} />
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

      <Route path="/" element={<Navigate to="/app/files" replace />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
