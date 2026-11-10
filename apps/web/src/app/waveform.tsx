import { useEffect, useRef } from 'react';
import { Region } from '../audio/settings';

const MIN_REGION_SECONDS = 1;
const DRAG_THRESHOLD_PX = 4;

interface WaveformProps {
  peaks: Float32Array;
  duration: number;
  region: Region;
  onRegionChange: (region: Region) => void;
  /** Aktuell uppspelningsposition i sekunder, eller null när inget spelas. */
  getPosition: () => number | null;
}

/** Vågform över hela låten. Dra för att markera ett avsnitt, klicka för att flytta det. */
export function Waveform({
  peaks,
  duration,
  region,
  onRegionChange,
  getPosition,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ startX: number; moved: boolean } | null>(null);

  // Ritas om varje bildruta, så att spelmarkören rör sig mjukt.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const ratio = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * ratio);
      const height = Math.round(canvas.clientHeight * ratio);
      if (width === 0 || height === 0) return;
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const style = getComputedStyle(canvas);
      const dim = style.getPropertyValue('--wave-dim');
      const bright = style.getPropertyValue('--wave-bright');
      const fill = style.getPropertyValue('--wave-region');
      const playhead = style.getPropertyValue('--wave-playhead');

      ctx.clearRect(0, 0, width, height);
      const fromX = (region.start / duration) * width;
      const toX = (region.end / duration) * width;
      ctx.fillStyle = fill;
      ctx.fillRect(fromX, 0, toX - fromX, height);

      let highest = 0;
      for (const peak of peaks) if (peak > highest) highest = peak;
      const scale = highest > 0 ? 1 / highest : 0;
      const middle = height / 2;
      for (let x = 0; x < width; x++) {
        const from = Math.floor((x / width) * peaks.length);
        const to = Math.max(from + 1, Math.floor(((x + 1) / width) * peaks.length));
        let peak = 0;
        for (let i = from; i < to; i++) if (peaks[i] > peak) peak = peaks[i];
        const bar = Math.max(1, peak * scale * (height - 4));
        ctx.fillStyle = x >= fromX && x <= toX ? bright : dim;
        ctx.fillRect(x, middle - bar / 2, 1, bar);
      }

      const position = getPosition();
      if (position !== null) {
        ctx.fillStyle = playhead;
        ctx.fillRect((position / duration) * width - ratio, 0, 2 * ratio, height);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [peaks, duration, region, getPosition]);

  const timeAt = (clientX: number): number => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const fraction = (clientX - rect.left) / rect.width;
    return Math.max(0, Math.min(1, fraction)) * duration;
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drag.current = { startX: event.clientX, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    if (!current) return;
    if (Math.abs(event.clientX - current.startX) < DRAG_THRESHOLD_PX && !current.moved) {
      return;
    }
    current.moved = true;
    const a = timeAt(current.startX);
    const b = timeAt(event.clientX);
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (end - start >= MIN_REGION_SECONDS) onRegionChange({ start, end });
  };

  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const current = drag.current;
    drag.current = null;
    if (!current || current.moved) return;
    // Ett klick utan att dra flyttar avsnittet och behåller längden.
    const length = region.end - region.start;
    const start = Math.min(timeAt(event.clientX), Math.max(0, duration - length));
    onRegionChange({ start, end: Math.min(start + length, duration) });
  };

  return (
    <canvas
      ref={canvasRef}
      className="waveform"
      role="img"
      aria-label="Vågform över låten med det markerade klippet"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (drag.current = null)}
    />
  );
}
