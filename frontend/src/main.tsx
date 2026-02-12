import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';

import App from './App';
import { UiPrefsProvider } from './contexts/UiPrefsContext';
import { queryClient } from './lib/query-client';
import './index.css';
import './styles/ide.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <UiPrefsProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <Toaster richColors position="top-right" />
      </UiPrefsProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
