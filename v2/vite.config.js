import { defineConfig } from 'vite';
import path from 'node:path';
import sirv from 'sirv';

const repoRoot = path.resolve(__dirname, '..');
const leaguesDir = path.join(repoRoot, 'leagues');

export default defineConfig({
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@tokens': path.resolve(__dirname, 'src/tokens'),
      '@themes': path.resolve(__dirname, 'src/themes'),
      '@primitives': path.resolve(__dirname, 'src/primitives'),
      '@components': path.resolve(__dirname, 'src/components'),
      '@tables': path.resolve(__dirname, 'src/tables'),
      '@data': path.resolve(__dirname, 'src/data'),
      '@compute': path.resolve(__dirname, 'src/compute'),
      '@utils': path.resolve(__dirname, 'src/utils'),
      '@i18n': path.resolve(__dirname, 'src/i18n'),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    fs: {
      allow: ['..', leaguesDir],
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        index:            path.resolve(__dirname, 'index.html'),
        landing:          path.resolve(__dirname, 'src/pages/landing/landing.html'),
        league:           path.resolve(__dirname, 'src/pages/league/league.html'),
        dashboard:        path.resolve(__dirname, 'src/pages/dashboard/dashboard.html'),
        player:           path.resolve(__dirname, 'src/pages/player/player.html'),
        playerGeneral:    path.resolve(__dirname, 'src/pages/playerGeneral/playerGeneral.html'),
        admin:            path.resolve(__dirname, 'src/pages/admin/admin.html'),
        designLab:        path.resolve(__dirname, 'src/tools/designLab/designLab.html'),
        typoEditor:       path.resolve(__dirname, 'src/tools/typoEditor/typoEditor.html'),
        tableLab:         path.resolve(__dirname, 'src/tools/tableLab/tableLab.html'),
        designCatalogue:  path.resolve(__dirname, 'src/tools/designCatalogue/catalogue.html'),
      },
    },
  },
  plugins: [
    // Serve the shared ../leagues directory at /data so both v1 and v2
    // read the same source files during dev. For production builds,
    // scripts/data-sync.js copies a snapshot into public/data.
    {
      name: 'shared-data-proxy',
      configureServer(server) {
        server.middlewares.use('/data', sirv(leaguesDir, { dev: true, etag: true }));
      },
    },
  ],
});
