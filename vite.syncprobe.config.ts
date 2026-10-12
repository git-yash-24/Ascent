import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// M6 sync probe: answers the three sync questions on a real phone.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist/sync-probe',
    emptyOutDir: true,
    rollupOptions: { input: 'prototypes/sync-probe.html' },
  },
});
