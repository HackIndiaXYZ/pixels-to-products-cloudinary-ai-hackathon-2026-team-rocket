'use client';

import { useEffect, useRef } from 'react';
import { isVideo, refOf, stillBase } from '@/lib/cloudinary/media';
import { component, deliveryUrl } from '@/lib/cloudinary/url';
import { useDeviceTier, useInViewport, useRafLoop, useReducedMotionPref } from '@/components/motion/hooks';
import { cn } from '@/components/ui/cn';
import { landingAsset } from '../landing-data';

const IDS = [
  'vo-road-collapse',
  'vo-bridge-truss',
  'vo-crew-ppe',
  'vo-demolition-deck',
  'vo-receiving-label',
  'vo-fleet-checkin',
  'vo-ole-survey',
  'vo-hot-work',
  'vo-washroom-panel',
  'vo-equipment-yard',
  'vo-fleet-dash',
  'vo-plant-walkthrough',
];

const TILE_W = 264;
const TILE_H = 176;
const GAP = 12;
/** Drift speed in px per millisecond (≈ 12 px/s): barely perceptible. */
const SPEED = 0.012;

/** Greyscale, eco-quality stills composed by Cloudinary — atmosphere should cost almost nothing. */
const TILES = IDS.map((id) => {
  const asset = landingAsset(id);
  return {
    id,
    url: deliveryUrl(
      refOf(asset),
      [...stillBase(asset), component({ c: 'fill', g: 'auto', h: TILE_H, w: TILE_W }), 'e_grayscale', 'q_auto:eco', 'f_auto'],
      isVideo(asset) ? 'jpg' : undefined,
    ),
  };
});

function TileSet({ hidden = false }: { hidden?: boolean }) {
  return (
    <div className="flex shrink-0" style={{ gap: GAP }} aria-hidden={hidden || undefined}>
      {TILES.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition
        <img
          key={t.id}
          src={t.url}
          alt=""
          width={TILE_W}
          height={TILE_H}
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-[132px] w-[198px] shrink-0 rounded-[4px] object-cover sm:h-[176px] sm:w-[264px]"
        />
      ))}
    </div>
  );
}

/**
 * A very dim strip of field captures drifting behind the closing statement.
 * Transform-only, one style write per frame, and only while on screen on a
 * capable device; static under reduced motion and on low-tier devices.
 */
export function DriftStrip({ className }: { className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const setRef = useRef<HTMLDivElement>(null);
  const period = useRef(0);
  const offset = useRef(0);
  const tier = useDeviceTier();
  const reduce = useReducedMotionPref();
  const inView = useInViewport(wrapRef, '80px 0px');
  const animated = tier === 'high' && !reduce;

  useEffect(() => {
    const el = setRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      period.current = entry.contentRect.width + GAP;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useRafLoop((_, delta) => {
    const track = trackRef.current;
    const p = period.current;
    if (!track || !p) return;
    offset.current -= delta * SPEED;
    if (offset.current <= -p) offset.current += p;
    track.style.transform = `translate3d(${offset.current.toFixed(2)}px,0,0)`;
  }, animated && inView);

  return (
    <div
      ref={wrapRef}
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_20%,black_80%,transparent)]',
        className,
      )}
    >
      <div ref={trackRef} className="flex w-max opacity-[0.08] will-change-transform" style={{ gap: GAP }}>
        <div ref={setRef} className="flex shrink-0">
          <TileSet />
        </div>
        {animated && <TileSet hidden />}
      </div>
    </div>
  );
}
