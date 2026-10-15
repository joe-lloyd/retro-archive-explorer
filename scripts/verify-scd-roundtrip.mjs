// Round-trips every room script through the encoder and the text assembler, and
// a sample of rooms through the writer. Usage:
//   node scripts/verify-scd-roundtrip.mjs <image | dir> [<image | dir> ...]
import { runTs } from './run-ts.mjs';

await runTs(import.meta.url, 'verify-scd-roundtrip.ts');
