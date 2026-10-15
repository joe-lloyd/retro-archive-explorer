// Bundles a scripts/*.ts entry (which imports the app's TypeScript parsers)
// with esbuild, then runs it, so scripts always use the same parsing code as
// the app. Usage: `await runTs(import.meta.url, 'cli.ts')`.
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

export async function runTs(callerUrl, entryName) {
  const entry = path.join(path.dirname(fileURLToPath(callerUrl)), entryName);
  const out = path.join(tmpdir(), `rae-${path.basename(entryName, '.ts')}-${process.pid}-${Date.now()}.mjs`);

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
}
