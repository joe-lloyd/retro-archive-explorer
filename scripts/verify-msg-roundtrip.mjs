// Round-trips every room message through the encoder, and a sample of rooms
// through the message writer. Usage:
//   node scripts/verify-msg-roundtrip.mjs <image | dir> [<image | dir> ...]
import { runTs } from './run-ts.mjs';

await runTs(import.meta.url, 'verify-msg-roundtrip.ts');
