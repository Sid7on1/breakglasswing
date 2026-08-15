import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Design preview: the real renderer components and the real `styles.css`, mounted in a browser with
 * a stubbed `window.bimax`.
 *
 * It exists so a shell change can be *looked at* — theme, window chrome and empty/full states side
 * by side — without launching Electron and driving the engine. The components are imported from
 * `src/renderer/src`, never copied: a harness that reproduced the markup would only ever verify
 * itself.
 */
export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  server: { port: 5199, strictPort: true },
});
