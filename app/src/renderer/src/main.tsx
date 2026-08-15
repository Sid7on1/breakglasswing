import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PermissionCoachOverlay } from './components/PermissionCoachOverlay';
import '@fontsource-variable/inter';
import './styles.css';

/**
 * The permission coach runs in its own always-on-top window (main/permission.coach.ts) but shares
 * this bundle, selected by hash so it needs no second Vite entry. It mounts WITHOUT the app: that
 * window has no engine, no project and no IPC listeners of its own, and booting the full App there
 * would spawn a second set of subscriptions against the same main process.
 */
const isCoach = window.location.hash.replace(/^#/, '') === 'permission-coach';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isCoach ? <PermissionCoachOverlay /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);
