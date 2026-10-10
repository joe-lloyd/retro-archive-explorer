// Launcher for the headless CLI: runs scripts/cli.ts through esbuild so the CLI
// always uses the same parsing code as the app. Run `pnpm rae` for usage.
import { runTs } from './run-ts.mjs';

await runTs(import.meta.url, 'cli.ts');
