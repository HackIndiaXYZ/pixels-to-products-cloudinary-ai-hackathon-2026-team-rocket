'use client';

import type { MediaAsset } from '@/lib/types';
import { frameUrl } from '@/lib/cloudinary/media';
import { formatDuration } from '@/lib/format';
import { cn } from '@/components/ui/cn';
import { CloudImage } from './CloudImage';

/**
 * Keyframes extracted from a video by Cloudinary (so_<seconds> → JPEG).
 * Clicking a frame seeks the player.
 */
export function FrameStrip({
  asset,
  duration,
  count = 6,
  onSeek,
  activeTime,
}: {
  asset: MediaAsset;
  duration: number | undefined;
  count?: number;
  onSeek?: (seconds: number) => void;
  activeTime?: number;
}) {
  const total = duration && Number.isFinite(duration) ? duration : asset.duration ?? 8;
  const times = Array.from({ length: count }, (_, i) => Math.max(0, Math.round(((total * (i + 0.5)) / count) * 10) / 10));
  return (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      {times.map((t) => {
        const active = activeTime !== undefined && Math.abs(activeTime - t) < total / count / 2;
        return (
          <button
            key={t}
            type="button"
            onClick={() => onSeek?.(t)}
            className={cn(
              'group relative aspect-video overflow-hidden rounded-[6px] border bg-raised text-left',
              active ? 'border-signal' : 'border-line hover:border-line-strong',
            )}
            title={`Seek to ${formatDuration(t)} (Cloudinary so_${t})`}
          >
            <CloudImage src={frameUrl(asset, t, 320, 180)} alt={`Frame at ${formatDuration(t)}`} className="h-full w-full object-cover" />
            <span className="num absolute bottom-1 left-1 rounded-[4px] bg-canvas/85 px-1 font-mono text-[10.5px] text-ink-2">
              {formatDuration(t)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
