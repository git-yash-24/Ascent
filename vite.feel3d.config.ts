import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// M2 prototype: the feel test in low-poly 3D, built as its own single page.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
    outDir: 'dist/feel-3d',
    emptyOutDir: true,
    rollupOptions: { input: 'prototypes/feel-3d.html' },
  },
});
