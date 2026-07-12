import { useEffect, useRef } from 'react';
import type { TextureAsset } from '../../../shared/types';

export function TextureViewer({ asset }: { asset: TextureAsset }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = asset.width;
    canvas.height = asset.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Copy into a fresh ArrayBuffer-backed array (ImageData rejects SharedArrayBuffer-backed).
    const pixels = new Uint8ClampedArray(asset.pixels);
    const image = new ImageData(pixels, asset.width, asset.height);
    ctx.putImageData(image, 0, 0);
  }, [asset]);

  return (
    <div className="texture-viewer">
      <div className="texture-meta">
        {asset.width}×{asset.height} · {asset.bitDepth}-bit
      </div>
      <div className="texture-stage">
        <canvas ref={canvasRef} className="texture-canvas" />
      </div>
    </div>
  );
}
