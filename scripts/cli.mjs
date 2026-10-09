// Launcher for the diagnostics analyzer: bundles scripts/analyze.ts (which
// imports the app's TypeScript parsers) with esbuild, then runs it. This keeps
// the analyzer using the exact same parsing code as the app.
//
//   pnpm analyze list <image> [ext]
//   pnpm analyze find <image> <substr>
//   pnpm analyze dump <image> <in/image/path>
import { build } from 'esbuild';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'analyze.ts');
const out = path.join(tmpdir(), `rae-analyze-${Date.now()}.mjs`);

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  logLevel: 'warning',
});

await import(pathToFileURL(out).href);
