import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

// Renderer served/built by Vite; main + preload compiled to dist-electron/
// via vite-plugin-electron so `main` in package.json resolves at runtime.
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process entry.
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: { external: ['electron'] },
          },
        },
      },
      {
        // Preload script (context-isolated bridge).
        // Emitted as CommonJS (.cjs): a sandboxed preload must be CJS, and the
        // package's "type": "module" would otherwise make a .js file ESM.
        entry: 'electron/preload.ts',
        onstart({ reload }) {
          reload();
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            lib: {
              entry: 'electron/preload.ts',
              formats: ['cjs'],
              fileName: () => 'preload.cjs',
            },
            rollupOptions: { external: ['electron'] },
          },
        },
      },
    ]),
    renderer(),
  ],
  build: {
    outDir: 'dist',
  },
});
