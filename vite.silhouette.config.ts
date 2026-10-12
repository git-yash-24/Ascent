import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// M3 prototype: the feel test as silhouette theatre, built as its own single page.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist/feel-silhouette',
    emptyOutDir: true,
    rollupOptions: { input: 'prototypes/feel-silhouette.html' },
  },
});
