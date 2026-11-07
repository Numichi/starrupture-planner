/**
 * Vite configuration.
 *
 * - `base: './'`: the built app (`dist/`) works from any sub-folder, including GitHub Pages.
 *   The data files stay editable in the build: `dist/data/*.yml`, `dist/icons/`.
 * - `@/` resolves to `src/` (same alias as in `tsconfig.json`).
 * - `gameDataWatcher`: live data reload during development.
 */
import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig, type Plugin } from 'vite'

/**
 * Live game data reload during development (`npm run dev`).
 *
 * When anything under `public/data/` or `public/icons/` changes (saved in an editor), the
 * plugin notifies the browser, which reloads the data without a page refresh (see
 * `usePlanner.ts`, event `game-data-changed`). The open project and settings stay as they are.
 */
function gameDataWatcher(): Plugin {
  return {
    name: 'game-data-watcher',

    configureServer(server) {
      const publicDir = server.config.publicDir.replace(/\\/g, '/')
      const watched = [`${publicDir}/data/`, `${publicDir}/icons/`]

      server.watcher.on('all', (_event, file) => {
        const path = file.replace(/\\/g, '/')

        if (watched.some((dir) => path.startsWith(dir))) {
          server.ws.send({ type: 'custom', event: 'game-data-changed', data: { file: path } })
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), gameDataWatcher()],
  base: './',

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },

  build: {
    // ELK alone is ~1.4 MB, so the default 500 kB warning limit is raised.
    chunkSizeWarningLimit: 2000,
  },
})
