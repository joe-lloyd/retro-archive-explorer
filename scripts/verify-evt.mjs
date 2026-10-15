// Checks the event script decoder, assembler and writer on a synthetic room,
// and round-trips every event script of the rooms given. Usage:
//   node scripts/verify-evt.mjs [<image | dir> ...]
import { runTs } from './run-ts.mjs';

await runTs(import.meta.url, 'verify-evt.ts');
