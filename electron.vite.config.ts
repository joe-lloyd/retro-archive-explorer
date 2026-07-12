import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Our source lives in electron/ (main + preload) and at the repo root (renderer),
// not electron-vite's default src/{main,preload,renderer}/, so entries are set
// explicitly via build.lib.entry (accepted by electron-vite at runtime).
//
// NOTE: electron-vite 5 ships Vite 6-oriented types; on Vite 5 its per-process
// `build` type resolves to `{}`, so the runtime-valid `lib` config is cast
// through `any`. Drop the casts if/when this project moves to Vite 6.
export default defineConfig({
  main: {
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/main.ts'),
        formats: ['es'],
        fileName: () => 'index.js'
      }
    } as any
  },
  preload: {
    build: {
      lib: {
        // Preload must be CommonJS for the sandbox; a .cjs file stays CJS even
        // though package.json is "type": "module".
        entry: resolve(__dirname, 'electron/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'preload.cjs'
      }
    } as any
  },
  renderer: {
    // index.html (-> /src/main.tsx) is at the repo root, not src/renderer/.
    root: '.',
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html')
        }
      }
    } as any,
    plugins: [react()]
  }
})
