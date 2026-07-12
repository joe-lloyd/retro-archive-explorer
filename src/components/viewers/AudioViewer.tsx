import { useEffect, useMemo, useRef, useState } from 'react';
import type { AudioAsset } from '../../../shared/types';

export function AudioViewer({ asset }: { asset: AudioAsset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [decodeError, setDecodeError] = useState<string | null>(null);

  // Build a playable object URL from the raw bytes.
  const url = useMemo(() => {
    const blob = new Blob([new Uint8Array(asset.bytes)], { type: asset.mime });
    return URL.createObjectURL(blob);
  }, [asset]);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  // Best-effort waveform: decode PCM and draw a min/max envelope. Proprietary
  // codecs (XA/VAG) may fail to decode; we surface that without breaking playback.
  useEffect(() => {
    let cancelled = false;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const audioCtx = new Ctx();
    // decodeAudioData needs a standalone, detachable ArrayBuffer.
    const copy = new Uint8Array(asset.bytes).buffer;
    audioCtx
      .decodeAudioData(copy)
      .then((decoded) => {
        if (cancelled) return;
        drawWaveform(canvasRef.current, decoded.getChannelData(0));
      })
      .catch(() => {
        if (!cancelled) setDecodeError('waveform unavailable for this codec');
      })
      .finally(() => audioCtx.close());
    return () => {
      cancelled = true;
    };
  }, [asset]);

  const playable = asset.bytes.length > 0;
  return (
    <div className="audio-viewer">
      {asset.note && <div className="audio-note">{asset.note}</div>}
      {playable ? (
        <>
          <canvas ref={canvasRef} className="audio-waveform" width={800} height={140} />
          {decodeError && <div className="audio-note">{decodeError}</div>}
          <audio className="audio-player" src={url} controls />
        </>
      ) : (
        <div className="audio-note">No playable audio stream could be produced for this file.</div>
      )}
    </div>
  );
}

function drawWaveform(canvas: HTMLCanvasElement | null, data: Float32Array): void {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#7dd3fc';
  const mid = height / 2;
  const step = Math.max(1, Math.floor(data.length / width));
  for (let x = 0; x < width; x++) {
    let min = 1;
    let max = -1;
    for (let i = 0; i < step; i++) {
      const sample = data[x * step + i] ?? 0;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }
    ctx.fillRect(x, mid + min * mid, 1, Math.max(1, (max - min) * mid));
  }
}
