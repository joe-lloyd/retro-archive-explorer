import type { AudioAsset } from '../../../shared/types';

// SPU-ADPCM filter coefficients (integer, /64).
const FILTER_POS = [0, 60, 115, 98, 122];
const FILTER_NEG = [0, 0, -52, -55, -60];
const BLOCK = 16; // bytes per ADPCM block (2 header + 14 data)

function clamp16(v: number): number {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return v;
}

/**
 * Decode PlayStation SPU-ADPCM sample data (16-byte blocks) into signed PCM16.
 * Each block: [shift/filter byte][flags byte][14 data bytes = 28 nibble samples].
 */
export function decodeAdpcm(data: Buffer): Int16Array {
  const out: number[] = [];
  let hist1 = 0;
  let hist2 = 0;
  for (let i = 0; i + BLOCK <= data.length; i += BLOCK) {
    const header = data[i];
    const shift = Math.min(header & 0x0f, 12);
    const filter = Math.min((header >> 4) & 0x0f, 4);
    const flags = data[i + 1];
    if (flags === 7) break; // end marker (RE1 uses flag 7 to stop)
    for (let n = 0; n < 14; n++) {
      const byte = data[i + 2 + n];
      for (let half = 0; half < 2; half++) {
        const nib = (byte >> (half * 4)) & 0x0f;
        const signed4 = nib > 7 ? nib - 16 : nib;
        const t = (signed4 << 12) >> shift;
        const predicted = clamp16(
          t + ((hist1 * FILTER_POS[filter] + hist2 * FILTER_NEG[filter]) >> 6),
        );
        hist2 = hist1;
        hist1 = predicted;
        out.push(predicted);
      }
    }
  }
  return Int16Array.from(out);
}

/** Wrap PCM16 mono samples in a minimal RIFF/WAVE container. */
export function pcmToWav(pcm: Int16Array, sampleRate: number): Uint8Array {
  const dataBytes = pcm.length * 2;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // fmt chunk size
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32); // block align
  buf.writeUInt16LE(16, 34); // bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i], 44 + i * 2);
  return new Uint8Array(buf);
}

/** Decode a `VAGp` file into a WAV byte stream. */
export function decodeVag(buffer: Buffer): { wav: Uint8Array; sampleRate: number } {
  const sampleRate = buffer.readUInt32BE(0x10) || 44100;
  const pcm = decodeAdpcm(buffer.subarray(0x30));
  return { wav: pcmToWav(pcm, sampleRate), sampleRate };
}

function magic(buffer: Buffer, n = 4): string {
  return buffer.length >= n ? buffer.toString('latin1', 0, n) : '';
}

/**
 * Turn an audio file into something the renderer can play. VAG/SPU-ADPCM is
 * decoded to WAV; already-playable containers pass through; undecodable codecs
 * (XA streaming, VAB banks) are identified and reported.
 */
export function parseAudio(buffer: Buffer, extension: string | undefined): AudioAsset {
  const sig = magic(buffer);

  if (sig === 'RIFF') {
    return { kind: 'audio', bytes: new Uint8Array(buffer), mime: 'audio/wav' };
  }
  if (sig === 'OggS') {
    return { kind: 'audio', bytes: new Uint8Array(buffer), mime: 'audio/ogg' };
  }
  if (sig === 'VAGp') {
    const { wav, sampleRate } = decodeVag(buffer);
    return {
      kind: 'audio',
      bytes: wav,
      mime: 'audio/wav',
      note: `Decoded PSX VAG (SPU-ADPCM) @ ${sampleRate} Hz`,
    };
  }
  if (sig === 'pBAV' || sig === 'VABp') {
    return {
      kind: 'audio',
      bytes: new Uint8Array(0),
      mime: 'application/octet-stream',
      note: 'VAB sample bank — contains multiple samples; per-sample decoding not yet supported.',
    };
  }
  if (extension === 'xa') {
    return {
      kind: 'audio',
      bytes: new Uint8Array(0),
      mime: 'application/octet-stream',
      note: 'CD-XA ADPCM streaming audio — sector de-interleaving not yet supported.',
    };
  }
  // Last resort: treat as raw SPU-ADPCM at a common RE1 rate.
  const pcm = decodeAdpcm(buffer);
  if (pcm.length === 0) throw new Error('unrecognized audio format');
  return {
    kind: 'audio',
    bytes: pcmToWav(pcm, 22050),
    mime: 'audio/wav',
    note: 'Interpreted as raw SPU-ADPCM (assumed 22050 Hz)',
  };
}
