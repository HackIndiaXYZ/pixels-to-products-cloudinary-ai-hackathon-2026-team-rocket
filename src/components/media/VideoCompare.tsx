'use client';

import { Pause, Play } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '@/components/ui/cn';
import { ProbedVideo } from './Probed';

/**
 * Original vs Cloudinary-processed video, side by side.
 * "Play both" starts them together; each keeps native controls.
 */
export function VideoCompare({
  beforeUrl,
  afterUrl,
  poster,
  afterPoster,
  aspect,
  afterAspect,
  beforeLabel = 'Original',
  afterLabel = 'Cloudinary output',
}: {
  beforeUrl: string;
  afterUrl: string;
  poster?: string;
  afterPoster?: string;
  aspect: number;
  afterAspect?: number;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const before = useRef<HTMLVideoElement>(null);
  const after = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggleBoth = async () => {
    const vids = [before.current, after.current].filter((v): v is HTMLVideoElement => Boolean(v));
    if (!vids.length) return;
    if (playing) {
      vids.forEach((v) => v.pause());
      setPlaying(false);
      return;
    }
    vids.forEach((v) => {
      v.currentTime = 0;
      v.muted = true;
    });
    await Promise.allSettled(vids.map((v) => v.play()));
    setPlaying(true);
  };

  return (
    <div className="overflow-hidden rounded-[12px] border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="label">Video · original vs output</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={toggleBoth}>
          {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {playing ? 'Pause both' : 'Play both'}
        </button>
      </div>
      <div className="grid gap-px bg-line md:grid-cols-2">
        {[
          { url: beforeUrl, label: beforeLabel, ref: before, ratio: aspect, poster },
          { url: afterUrl, label: afterLabel, ref: after, ratio: afterAspect ?? aspect, poster: afterPoster ?? poster },
        ].map((pane, i) => (
          <div key={i} className="relative bg-black">
            <div className="relative mx-auto" style={{ aspectRatio: `${Math.max(pane.ratio, 0.5)}`, maxHeight: '60vh' }}>
              <ProbedVideo url={pane.url} poster={pane.poster} videoRef={pane.ref} />
            </div>
            <span
              className={cn(
                'pointer-events-none absolute left-3 top-3 rounded-[6px] border px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em]',
                i === 1 ? 'border-[color-mix(in_oklab,var(--color-signal)_45%,transparent)] bg-canvas/85 text-signal' : 'border-line-strong bg-canvas/85 text-ink-2',
              )}
            >
              {pane.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
