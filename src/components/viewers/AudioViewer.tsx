import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { AudioAsset } from '../../../shared/types';

function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Decodes the (already WAV-wrapped) audio once via Web Audio and plays the
 * resulting AudioBuffer directly. This avoids the <audio> element, which was
 * reporting 0s / refusing to play the decoded PSX streams.
 */
export function AudioViewer({ asset }: { asset: AudioAsset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const startedAtRef = useRef(0); // ctx time when playback (re)started
  const offsetRef = useRef(0); // seconds into the buffer at that start
  const rafRef = useRef(0);

  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0); // 0..1
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const playable = asset.bytes.length > 0;

  // One AudioContext for decode + playback.
  const getCtx = useCallback(() => {
    if (!ctxRef.current) {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      ctxRef.current = new Ctx();
    }
    return ctxRef.current;
  }, []);

  // Decode once; draw the waveform; record duration.
  useEffect(() => {
    if (!playable) return;
    let cancelled = false;
    const ctx = getCtx();
    const copy = new Uint8Array(asset.bytes).buffer;
    ctx
      .decodeAudioData(copy)
      .then((buf) => {
        if (cancelled) return;
        bufferRef.current = buf;
        setDuration(buf.duration);
        drawWaveform(canvasRef.current, buf.getChannelData(0));
      })
      .catch(() => {
        if (!cancelled) setError('This audio could not be decoded for playback.');
      });
    return () => {
      cancelled = true;
    };
  }, [asset, playable, getCtx]);

  const stopSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try {
        sourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
  }, []);

  const startAt = useCallback(
    (offset: number) => {
      const ctx = getCtx();
      const buffer = bufferRef.current;
      if (!buffer) return;
      void ctx.resume();
      stopSource();
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.onended = () => {
        // Natural end (not a manual stop): reset to the start.
        if (sourceRef.current === src) {
          setPlaying(false);
          setProgress(0);
          offsetRef.current = 0;
          sourceRef.current = null;
        }
      };
      src.start(0, Math.max(0, Math.min(offset, buffer.duration)));
      sourceRef.current = src;
      startedAtRef.current = ctx.currentTime;
      offsetRef.current = offset;
      setPlaying(true);
    },
    [getCtx, stopSource],
  );

  const pause = useCallback(() => {
    const ctx = getCtx();
    const elapsed = ctx.currentTime - startedAtRef.current;
    offsetRef.current = Math.min(offsetRef.current + elapsed, duration);
    stopSource();
    setPlaying(false);
  }, [getCtx, stopSource, duration]);

  const toggle = () => (playing ? pause() : startAt(offsetRef.current >= duration ? 0 : offsetRef.current));

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    if (playing) startAt(frac * duration);
    else {
      offsetRef.current = frac * duration;
      setProgress(frac);
    }
  };

  // Progress ticker while playing.
  useEffect(() => {
    if (!playing) return;
    const tick = () => {
      const ctx = ctxRef.current;
      if (ctx && duration) {
        const cur = offsetRef.current + (ctx.currentTime - startedAtRef.current);
        setProgress(Math.min(1, cur / duration));
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, duration]);

  // Tear down on unmount.
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      stopSource();
      void ctxRef.current?.close();
      ctxRef.current = null;
    },
    [stopSource],
  );

  const current = useMemo(() => progress * duration, [progress, duration]);

  return (
    <div className="audio-viewer">
      {asset.note && <div className="audio-note">{asset.note}</div>}
      {!playable ? (
        <div className="audio-note">No playable audio stream could be produced for this file.</div>
      ) : (
        <>
          <div className="audio-stage" onClick={seek}>
            <canvas ref={canvasRef} className="audio-waveform" width={800} height={140} />
            <div className="audio-progress" style={{ left: `${progress * 100}%` }} />
          </div>
          <div className="audio-transport">
            <button className="audio-play" onClick={toggle} disabled={!duration}>
              {playing ? <Pause size={16} /> : <Play size={16} />}
              {playing ? 'Pause' : 'Play'}
            </button>
            <span className="audio-time">
              {fmt(current)} / {fmt(duration)}
            </span>
          </div>
          {error && <div className="audio-note">{error}</div>}
        </>
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
