'use client';

import { AnimatePresence, animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion';
import { ArrowUpRight, ChevronsLeftRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaAsset } from '@/lib/types';
import { CROP_LABEL, describeCropCentre, fetchInsight } from '@/lib/cloudinary/insights';
import { frameUrl, posterOffset } from '@/lib/cloudinary/media';
import { IMAGE_ACCEPT, type DeliveryMetrics } from '@/lib/cloudinary/probe';
import { formatBytes, formatDuration, formatMs } from '@/lib/format';
import { useProbe } from '@/components/media/useProbe';
import { RegionLayer } from '@/components/media/RegionLayer';
import { clamp, usePageVisible, useReducedMotionPref } from '@/components/motion/hooks';
import { CopyButton } from '@/components/ui/CopyButton';
import { IntegrityBadge } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { frameStill, frameThumb, type Capability } from './capabilities';
import { fetchGetInfo, useInsightFrom } from './hooks';
import { ProbedImg, StatusChip } from './ProbedMedia';

const EASE = [0.16, 1, 0.3, 1] as const;

const timecode = (s: number) => formatDuration(s).padStart(5, '0');

function Tag({ children, className, tone = 'plain' }: { children: React.ReactNode; className?: string; tone?: 'plain' | 'signal' }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute z-10 whitespace-nowrap rounded-[4px] px-1.5 py-[3px] font-mono text-[10.5px] font-medium uppercase leading-none tracking-[0.06em]',
        tone === 'signal' ? 'bg-signal text-signal-ink' : 'bg-canvas/88 text-ink-2',
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Compare: aligned before / after with a draggable split                  */
/* ---------------------------------------------------------------------- */

function CompareView({ cap, enabled }: { cap: Capability; enabled: boolean }) {
  const reduce = useReducedMotionPref();
  const split = useMotionValue(100);
  const afterClip = useTransform(split, (v) => `inset(0 0 0 ${v}%)`);
  const beforeClip = useTransform(split, (v) => `inset(0 ${100 - v}% 0 0)`);
  const handleX = useTransform(split, (v) => `${v}%`);
  const boxRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const rect = useRef<{ left: number; width: number } | null>(null);
  const dragging = useRef(false);
  const touched = useRef(false);
  const [revealed, setRevealed] = useState(false);
  const afterResult = useProbe(cap.after, { accept: IMAGE_ACCEPT, enabled });

  const loadFaces = useCallback(() => fetchInsight(cap.asset), [cap.asset]);
  const { insight } = useInsightFrom(cap.faces ? loadFaces : null, cap.asset.id, enabled);

  useMotionValueEvent(split, 'change', (v) => {
    handleRef.current?.setAttribute('aria-valuenow', String(Math.round(v)));
  });

  const onReady = () => {
    setRevealed(true);
    if (touched.current) return;
    if (reduce) split.set(50);
    else animate(split, 50, { duration: 0.9, ease: EASE });
  };

  const cacheRect = () => {
    const r = boxRef.current?.getBoundingClientRect();
    if (r) rect.current = { left: r.left, width: r.width };
  };
  const setFrom = (clientX: number) => {
    if (!rect.current) cacheRect();
    const r = rect.current;
    if (!r || !r.width) return;
    touched.current = true;
    split.stop();
    split.set(clamp(((clientX - r.left) / r.width) * 100, 0, 100));
  };

  const w = cap.asset.width;
  const h = cap.asset.height;

  return (
    <div className="absolute inset-0 grid place-items-center">
      <div
        ref={boxRef}
        data-cursor="COMPARE"
        onPointerEnter={cacheRect}
        onPointerDown={(e) => {
          if (!revealed) return;
          cacheRect();
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          setFrom(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!revealed) return;
          if (e.pointerType === 'mouse' || dragging.current) setFrom(e.clientX);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
        className="relative touch-pan-y select-none overflow-hidden bg-raised"
        style={{ aspectRatio: `${w} / ${h}`, width: `min(100cqw, calc(100cqh * ${w / h}))` }}
      >
        {enabled && (
          // eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition
          <img
            src={cap.before}
            alt={`${cap.asset.title} — original`}
            loading="lazy"
            decoding="async"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}

        {insight && insight.faces.length > 0 && (
          <motion.div className="absolute inset-0" style={{ clipPath: beforeClip }}>
            <RegionLayer regions={insight.faces.map((f) => ({ ...f, label: 'FACE' }))} variant="face" />
          </motion.div>
        )}

        <motion.div className={cn('absolute inset-0', cap.checker && 'checker')} style={{ clipPath: afterClip }}>
          <ProbedImg url={cap.after} alt={`${cap.asset.title} — ${cap.title}`} enabled={enabled} onReady={onReady} status={false} />
        </motion.div>

        <Tag className="left-2.5 top-2.5">{cap.beforeLabel ?? 'Original'}</Tag>
        <Tag className="right-2.5 top-2.5" tone={revealed ? 'signal' : 'plain'}>
          {cap.afterLabel}
        </Tag>

        <motion.div aria-hidden={!revealed} className="pointer-events-none absolute inset-y-0 left-0 w-full" style={{ x: handleX }}>
          <div className={cn('absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-signal transition-opacity duration-300', revealed ? 'opacity-100' : 'opacity-0')} />
          <div
            ref={handleRef}
            role="slider"
            tabIndex={revealed ? 0 : -1}
            aria-label={`Compare the original with ${cap.title}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={100}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 20 : 5;
              const next =
                e.key === 'ArrowLeft' ? split.get() - step : e.key === 'ArrowRight' ? split.get() + step : e.key === 'Home' ? 0 : e.key === 'End' ? 100 : null;
              if (next === null) return;
              e.preventDefault();
              touched.current = true;
              split.stop();
              split.set(clamp(next, 0, 100));
            }}
            className={cn(
              'pointer-events-auto absolute left-0 top-1/2 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-signal bg-canvas text-signal transition-opacity duration-300',
              revealed ? 'opacity-100' : 'opacity-0',
            )}
          >
            <ChevronsLeftRight className="h-3.5 w-3.5" />
          </div>
        </motion.div>

        {enabled && <StatusChip result={afterResult} loading={!revealed} />}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Crop: the frame with Cloudinary's subject window, and the crop itself   */
/* ---------------------------------------------------------------------- */

function CropView({ cap, enabled }: { cap: Capability; enabled: boolean }) {
  const reduce = useReducedMotionPref();
  const [ready, setReady] = useState(false);
  const infoUrl = cap.getInfoUrl ?? '';
  const loadInfo = useCallback(() => fetchGetInfo(infoUrl), [infoUrl]);
  const { insight } = useInsightFrom(infoUrl ? loadInfo : null, infoUrl, enabled);
  const result = useProbe(cap.after, { accept: IMAGE_ACCEPT, enabled });
  const inAr = cap.asset.width / cap.asset.height;
  const outAr = cap.outputAspect ?? 1;
  const focus = insight?.focus;

  return (
    <div className="absolute inset-0 grid place-items-center p-4">
      <div
        className="flex items-start gap-3"
        style={{ width: `min(calc(100cqw - 32px), calc((100cqh - 32px) * ${inAr + outAr} + 12px))` }}
      >
        <div className="relative overflow-hidden rounded-[4px] bg-raised" style={{ flex: `${inAr} 1 0%`, aspectRatio: inAr }}>
          {enabled && (
            // eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition
            <img
              src={cap.before}
              alt={`${cap.asset.title} — original frame`}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          {focus && (
            <>
              <motion.div
                aria-hidden
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, ease: EASE }}
                className="pointer-events-none absolute"
                style={{
                  left: `${focus.x}%`,
                  top: `${focus.y}%`,
                  width: `${focus.w}%`,
                  height: `${focus.h}%`,
                  boxShadow: '0 0 0 100vmax color-mix(in oklab, var(--color-canvas) 58%, transparent)',
                }}
              />
              <RegionLayer
                regions={[{ ...focus, label: cap.outputRatio ? `g_auto ${cap.outputRatio} crop` : CROP_LABEL }]}
                variant="focus"
              />
            </>
          )}
          <Tag className="bottom-2 left-2">
            Original · {cap.asset.width}×{cap.asset.height}
            {focus && <span className="hidden sm:inline"> · crop {describeCropCentre(focus)}</span>}
          </Tag>
        </div>

        <div className="relative overflow-hidden rounded-[4px] bg-raised" style={{ flex: `${outAr} 1 0%`, aspectRatio: outAr }}>
          <motion.div
            className="absolute inset-0"
            initial={reduce ? false : { clipPath: 'inset(0% 0% 100% 0%)' }}
            animate={ready || reduce ? { clipPath: 'inset(0% 0% 0% 0%)' } : undefined}
            transition={{ duration: 0.75, ease: EASE }}
          >
            <ProbedImg url={cap.after} alt={`${cap.asset.title} — ${cap.title}`} enabled={enabled} onReady={() => setReady(true)} status={false} />
          </motion.div>
          <Tag className="bottom-2 left-2" tone={ready ? 'signal' : 'plain'}>
            {cap.afterLabel}
          </Tag>
        </div>
      </div>
      {enabled && <StatusChip result={result} loading={!ready} />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Frames / highlights: source frames on the left, output on the right     */
/* ---------------------------------------------------------------------- */

function FrameColumn({
  asset,
  offsets,
  enabled,
  selected,
  onSelect,
}: {
  asset: MediaAsset;
  offsets: number[];
  enabled: boolean;
  selected?: number;
  onSelect?: (t: number) => void;
}) {
  return (
    <div className="grid min-h-0 gap-2" style={{ gridTemplateRows: `repeat(${offsets.length}, minmax(0, 1fr))` }}>
      {offsets.map((t) => {
        const on = selected === t;
        const body = (
          <>
            {enabled && (
              // eslint-disable-next-line @next/next/no-img-element -- Cloudinary frame grab
              <img src={frameThumb(asset, t)} alt="" loading="lazy" decoding="async" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
            )}
            <span className="absolute bottom-1 left-1 rounded-[3px] bg-canvas/88 px-1 py-[2px] font-mono text-[9px] leading-none text-ink-2">
              {timecode(t)}
            </span>
          </>
        );
        return onSelect ? (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            aria-label={`Extract the frame at ${timecode(t)}`}
            data-cursor="VIEW"
            onClick={() => onSelect(t)}
            className={cn(
              'relative min-h-0 overflow-hidden rounded-[4px] border bg-raised outline-offset-2 transition-[border-color,opacity] duration-200',
              on ? 'border-signal opacity-100' : 'border-line opacity-60 hover:opacity-100',
            )}
          >
            {body}
          </button>
        ) : (
          <div key={t} className="relative min-h-0 overflow-hidden rounded-[4px] border border-line bg-raised">
            {body}
          </div>
        );
      })}
    </div>
  );
}

function FramesView({ cap, enabled, offset, onOffset }: { cap: Capability; enabled: boolean; offset: number; onOffset: (t: number) => void }) {
  const url = frameStill(cap.asset, offset);
  const result = useProbe(url, { accept: IMAGE_ACCEPT, enabled });
  const [loaded, setLoaded] = useState<string | null>(null);
  return (
    <div className="absolute inset-0 grid grid-cols-[minmax(0,1fr)_minmax(0,4fr)] gap-3 p-3 sm:gap-4 sm:p-5">
      <FrameColumn asset={cap.asset} offsets={cap.offsets ?? []} enabled={enabled} selected={offset} onSelect={onOffset} />
      <div className="flex min-h-0 items-center">
        <div className="relative aspect-video w-full overflow-hidden rounded-[4px] bg-raised">
          <ProbedImg url={url} alt={`${cap.asset.title} — frame at ${timecode(offset)}`} enabled={enabled} onReady={() => setLoaded(url)} status={false} />
          <Tag className="left-2 top-2" tone={loaded === url ? 'signal' : 'plain'}>
            so_{offset} · {timecode(offset)}
          </Tag>
          <Tag className="bottom-2 right-2">{cap.asset.fileName}</Tag>
          {enabled && <StatusChip result={result} loading={loaded !== url} className="bottom-2 left-2" />}
        </div>
      </div>
    </div>
  );
}

function HighlightView({ cap, enabled, playing }: { cap: Capability; enabled: boolean; playing: boolean }) {
  const reduce = useReducedMotionPref();
  const visible = usePageVisible();
  const result = useProbe(cap.after, { enabled });
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);
  const confirmed = result?.kind === 'ready';
  const poster = frameUrl(cap.asset, posterOffset(cap.asset), 960, 540);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !confirmed) return;
    if (playing && visible && !reduce) void video.play().catch(() => undefined);
    else video.pause();
  }, [playing, visible, reduce, confirmed]);

  return (
    <div className="absolute inset-0 grid grid-cols-[minmax(0,1fr)_minmax(0,4fr)] gap-3 p-3 sm:gap-4 sm:p-5">
      <FrameColumn asset={cap.asset} offsets={cap.offsets ?? []} enabled={enabled} />
      <div className="flex min-h-0 items-center">
        <div className="relative aspect-video w-full overflow-hidden rounded-[4px] bg-raised">
          {enabled && !loaded && (
            // eslint-disable-next-line @next/next/no-img-element -- Cloudinary frame grab (poster)
            <img src={poster} alt="" aria-hidden loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-40" />
          )}
          {enabled && confirmed && (
            <video
              ref={videoRef}
              src={cap.after}
              poster={poster}
              muted
              loop
              playsInline
              controls={reduce}
              preload="metadata"
              onLoadedMetadata={() => setLoaded(true)}
              aria-label={`${cap.asset.title} — ${cap.title}`}
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <Tag className="left-2 top-2" tone={loaded ? 'signal' : 'plain'}>
            {cap.afterLabel}
          </Tag>
          <Tag className="right-2 top-2">Source {formatDuration(cap.asset.duration)}</Tag>
          {enabled && <StatusChip result={result} loading={!loaded} className="bottom-2 left-2" />}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Meta: title, URL anatomy, live delivery readout                         */
/* ---------------------------------------------------------------------- */

function UrlAnatomy({ url, focus }: { url: string; focus: string[] }) {
  const m = url.match(/^https:\/\/(res\.cloudinary\.com\/[^/]+\/(?:image|video)\/upload)\/(.+)$/);
  if (!m) return <code className="break-all font-mono text-[11.5px] text-ink-3">{url}</code>;
  const segments = m[2].split('/');
  let n = 0;
  while (n < segments.length - 1 && /^[a-z]{1,3}_/.test(segments[n])) n += 1;
  const components = segments.slice(0, n);
  const publicId = segments.slice(n).join('/');
  return (
    <code className="block font-mono text-[11.5px] leading-[1.7] text-ink-3 [overflow-wrap:anywhere]">
      <span>{m[1]}/</span>
      <wbr />
      {components.map((c, i) => (
        <span key={i}>
          <span className={focus.includes(c) ? 'rounded-[2px] bg-signal/12 text-signal' : 'text-ink-2'}>{c}</span>/
          <wbr />
        </span>
      ))}
      <span>{publicId}</span>
    </code>
  );
}

interface Cell {
  k: string;
  v: string;
  s: string;
  accent?: boolean;
}

const fmtUpper = (f: string | undefined) => (f ?? '—').toUpperCase();
const dims = (w?: number, h?: number) => (w && h ? `${w}×${h}` : '—');
const delta = (from?: number, to?: number) => {
  if (!from || !to) return '—';
  const pct = (to / from - 1) * 100;
  return `${pct <= 0 ? '−' : '+'}${Math.abs(pct) >= 10 ? Math.round(Math.abs(pct)) : Math.abs(pct).toFixed(1)}%`;
};

function readoutCells(cap: Capability, m: DeliveryMetrics | undefined, before: DeliveryMetrics | undefined, offset: number): Cell[] {
  const a = cap.asset;
  const edge: Cell = m
    ? {
        k: 'Edge',
        v: `CDN ${m.cache ?? 'n/a'}`,
        s: `${formatMs(m.elapsedMs)} round-trip${m.transformMs !== undefined ? ` · transform ${formatMs(m.transformMs)}` : ''}`,
      }
    : { k: 'Edge', v: '—', s: 'measuring…' };

  if (cap.mode === 'frames') {
    return [
      { k: 'Source', v: `${fmtUpper(a.format)} · ${dims(a.width, a.height)}`, s: `${formatBytes(a.bytes)} · ${a.fileName}` },
      { k: 'Frame', v: m ? `${fmtUpper(m.format)} · ${dims(m.width, m.height)}` : '—', s: m ? formatBytes(m.bytes) : 'measuring…', accent: true },
      { k: 'Offset', v: `so_${offset}`, s: `${timecode(offset)} into the pass` },
      edge,
    ];
  }

  if (cap.mode === 'highlight') {
    const srcBytes = m?.originalBytes ?? a.bytes;
    return [
      { k: 'Source', v: `${fmtUpper(m?.originalFormat ?? a.format)} · ${dims(m?.originalWidth ?? a.width, m?.originalHeight ?? a.height)}`, s: `${formatBytes(srcBytes)} · ${formatDuration(a.duration)}` },
      {
        k: 'Highlight',
        v: m ? `${fmtUpper(m.format)} · ${dims(m.width, m.height)}` : '—',
        s: m ? `${formatBytes(m.bytes)}${m.duration !== undefined ? ` · ${m.duration.toFixed(1)} s` : ''}` : 'measuring…',
        accent: true,
      },
      { k: 'Change', v: m ? delta(srcBytes, m.bytes) : '—', s: m?.duration !== undefined && a.duration ? `${a.duration.toFixed(1)} s → ${m.duration.toFixed(1)} s` : 'bytes vs source' },
      edge,
    ];
  }

  const oBytes = m?.originalBytes ?? a.bytes;
  const original: Cell = {
    k: 'Stored original',
    v: `${fmtUpper(m?.originalFormat ?? a.format)} · ${dims(m?.originalWidth ?? a.width, m?.originalHeight ?? a.height)}`,
    s: formatBytes(oBytes),
  };

  if (cap.measureBefore) {
    return [
      { k: 'Plain JPEG', v: before ? `${fmtUpper(before.format)} · ${dims(before.width, before.height)}` : '—', s: before ? formatBytes(before.bytes) : 'measuring…' },
      { k: 'q_auto,f_auto', v: m ? `${fmtUpper(m.format)} · ${dims(m.width, m.height)}` : '—', s: m ? formatBytes(m.bytes) : 'measuring…', accent: true },
      { k: 'Saved', v: before && m ? delta(before.bytes, m.bytes) : '—', s: 'same pixels, fewer bytes' },
      { ...original, s: `${formatBytes(oBytes)} · never downloaded here` },
    ];
  }

  return [
    original,
    { k: 'Output', v: m ? `${fmtUpper(m.format)} · ${dims(m.width, m.height)}` : '—', s: m ? formatBytes(m.bytes) : 'measuring…', accent: true },
    { k: 'Change', v: m ? delta(oBytes, m.bytes) : '—', s: 'bytes vs stored original' },
    edge,
  ];
}

function Readout({ cap, url, enabled, offset }: { cap: Capability; url: string; enabled: boolean; offset: number }) {
  const isVideo = cap.mode === 'highlight';
  const result = useProbe(url, { accept: isVideo ? undefined : IMAGE_ACCEPT, enabled });
  const beforeResult = useProbe(cap.measureBefore && cap.before ? cap.before : null, { accept: IMAGE_ACCEPT, enabled });
  const m = result?.kind === 'ready' ? result.metrics : undefined;
  const before = beforeResult?.kind === 'ready' ? beforeResult.metrics : undefined;
  const cells = readoutCells(cap, m, before, offset);
  const failed = result && (result.kind === 'error' || result.kind === 'network');

  return (
    <div>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-line bg-line sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.k} className="min-w-0 bg-canvas px-3 py-2.5">
            <dt className="label truncate">{c.k}</dt>
            <dd className={cn('num mt-1.5 truncate font-mono text-[12px]', c.accent && m ? 'text-signal' : c.v === '—' ? 'text-ink-3' : 'text-ink')}>{c.v}</dd>
            <dd className="num mt-0.5 truncate font-mono text-[10.5px] text-ink-3" title={c.s}>
              {c.s}
            </dd>
          </div>
        ))}
      </dl>
      {failed && (
        <p className="mt-2 font-mono text-[11px] text-critical">
          {result.kind === 'network'
            ? 'Cloudinary could not be reached from this browser.'
            : result.source === 'x-cld-error'
              ? `Cloudinary answered HTTP ${result.status}: ${result.message}`
              : `Cloudinary answered HTTP ${result.status} with no explanation (no X-Cld-Error header).`}
        </p>
      )}
    </div>
  );
}

function Meta({ cap, url, focus, enabled, offset }: { cap: Capability; url: string; focus: string[]; enabled: boolean; offset: number }) {
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <IntegrityBadge integrity={cap.integrity} />
        <h3 className="type-heading text-[20px] sm:text-[22px]">{cap.title}</h3>
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          <CopyButton value={url} label="Copy URL" />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open the ${cap.title.toLowerCase()} output URL on Cloudinary (opens in a new tab)`}
            className="btn btn-secondary btn-sm"
          >
            Open URL <ArrowUpRight aria-hidden className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
      <p className="max-w-[68ch] text-[14.5px] leading-relaxed text-ink-2">
        {cap.summary}
        {cap.note && <span className="text-ink-3"> {cap.note}</span>}
      </p>
      <UrlAnatomy url={url} focus={focus} />
      <Readout cap={cap} url={url} enabled={enabled} offset={offset} />
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Preview                                                                 */
/* ---------------------------------------------------------------------- */

export function CapabilityPreview({
  cap,
  enabled,
  playing,
  className,
}: {
  cap: Capability;
  /** Cloudinary requests are allowed (the explorer is near the viewport). */
  enabled: boolean;
  /** The explorer is on screen (video may play). */
  playing: boolean;
  className?: string;
}) {
  const [offsets, setOffsets] = useState<Record<string, number>>({});
  const offset = offsets[cap.id] ?? (cap.offsets ? cap.offsets[Math.floor(cap.offsets.length / 2)] : 0);
  const url = cap.mode === 'frames' ? frameStill(cap.asset, offset) : cap.after;
  const focus = cap.mode === 'frames' ? [`so_${offset}`] : cap.focus;

  return (
    <div className={className}>
      <div className="relative aspect-[4/3] overflow-hidden rounded-[8px] border border-line bg-surface [container-type:size] sm:aspect-[16/10]">
        <AnimatePresence initial={false}>
          <motion.div
            key={cap.id}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.32, ease: EASE }}
          >
            {cap.mode === 'compare' && <CompareView cap={cap} enabled={enabled} />}
            {cap.mode === 'crop' && <CropView cap={cap} enabled={enabled} />}
            {cap.mode === 'frames' && (
              <FramesView cap={cap} enabled={enabled} offset={offset} onOffset={(t) => setOffsets((o) => ({ ...o, [cap.id]: t }))} />
            )}
            {cap.mode === 'highlight' && <HighlightView cap={cap} enabled={enabled} playing={playing} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="mt-5 lg:min-h-[272px]">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={cap.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <Meta cap={cap} url={url} focus={focus} enabled={enabled} offset={offset} />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
