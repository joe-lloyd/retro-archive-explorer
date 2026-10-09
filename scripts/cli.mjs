// Launcher for the headless CLI: bundles scripts/cli.ts (which imports the
// app's TypeScript parsers) with esbuild, then runs it, so the CLI always uses
// the same parsing code as the app. Run `pnpm rae` for usage.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'cli.ts');
const out = path.join(tmpdir(), `rae-cli-${process.pid}-${Date.now()}.mjs`);

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  logLevel: 'warning',
});

try {
  await import(pathToFileURL(out).href);
} finally {
  rmSync(out, { force: true });
}
