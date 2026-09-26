'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { MediaAsset } from '@/lib/types';
import type { ProbeResult } from '@/lib/cloudinary/probe';
import { formatBytes, formatMs } from '@/lib/format';
import { LiveDot } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import styles from './hero.module.css';

const delay = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

/** What the delivery line needs to know about the stored asset. */
export type TelemetrySource = Pick<MediaAsset, 'resourceType' | 'format' | 'bytes'>;

/**
 * The technical layer under the inspection frame. The schema (labels and
 * hairlines) is always present; values populate once the frame has been read.
 * Delivery numbers are Cloudinary's own Server-Timing figures for the exact
 * rendition on screen plus the round-trip measured in this browser — never
 * estimates. For a video, the chain starts at the stored source file and names
 * the still Cloudinary grabbed from it (`so_`), because that frame grab — not
 * the video — is what Server-Timing reports as the "original".
 */
export function HeroTelemetry({
  on,
  fileName,
  frame,
  site,
  source,
  components,
  probe,
  className,
}: {
  on: boolean;
  fileName: string;
  frame: string;
  site: string;
  source: TelemetrySource;
  /** Transformation components of the delivered URL, in order. */
  components: string[];
  probe: ProbeResult | undefined;
  className?: string;
}) {
  const deliveryDelay = 200 + components.length * 45;
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[8px] border border-line bg-[color-mix(in_oklab,var(--color-canvas)_82%,transparent)] font-mono text-[11px] leading-[1.45]',
        className,
      )}
    >
      <dl className="grid grid-cols-[auto_auto_minmax(0,1fr)] border-b border-line">
        <Cell label="File" on={on} ms={0}>
          <span className="text-ink">{fileName}</span>
        </Cell>
        <Cell label="Frame" on={on} ms={60} className="border-l border-line">
          <span className="num text-ink">{frame}</span>
        </Cell>
        <Cell label="Site" on={on} ms={120} className="border-l border-line">
          <span className="text-ink-2">{site}</span>
        </Cell>
      </dl>

      <dl>
        <div className="border-b border-line px-3 py-2.5 sm:grid sm:grid-cols-[84px_minmax(0,1fr)] sm:gap-3">
          <dt className="label leading-[1.45]">Transform</dt>
          <dd className="mt-1 flex flex-wrap gap-y-0.5 sm:mt-0">
            {components.map((part, i) => (
              <span key={part} className={styles.value} data-on={on} style={delay(180 + i * 45)}>
                {i > 0 && (
                  <span aria-hidden className="px-1.5 text-ink-3">
                    ·
                  </span>
                )}
                <span className="text-ink-2">{part}</span>
              </span>
            ))}
          </dd>
        </div>

        <div className="px-3 py-2.5 sm:grid sm:grid-cols-[84px_minmax(0,1fr)] sm:gap-3">
          <dt className="label flex items-center gap-1.5 leading-[1.45]">
            <LiveDot />
            Delivery
          </dt>
          <dd className="mt-1 sm:mt-0">
            <span
              key={probe?.kind ?? 'pending'}
              className={styles.value}
              data-on={on}
              style={delay(deliveryDelay)}
              title={
                source.resourceType === 'video'
                  ? "Source size from the asset record; frame-grab and delivered sizes from Cloudinary's Server-Timing header for this exact rendition; time is the round trip measured in your browser."
                  : "Sizes and formats from Cloudinary's Server-Timing header for this exact rendition; time is the round trip measured in your browser."
              }
            >
              <Delivery probe={probe} source={source} components={components} />
            </span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Cell({
  label,
  on,
  ms,
  className,
  children,
}: {
  label: string;
  on: boolean;
  ms: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('min-w-0 px-3 py-2.5', className)}>
      <dt className="label">{label}</dt>
      <dd className="mt-1 truncate">
        <span className={styles.value} data-on={on} style={delay(ms)}>
          {children}
        </span>
      </dd>
    </div>
  );
}

function Delivery({
  probe,
  source,
  components,
}: {
  probe: ProbeResult | undefined;
  source: TelemetrySource;
  components: string[];
}) {
  if (!probe) return <span className="text-ink-3">measuring…</span>;
  if (probe.kind === 'processing') return <span className="text-ink-3">Cloudinary is rendering…</span>;
  if (probe.kind === 'error') {
    return (
      <span className="text-ink-3">
        unavailable · HTTP {probe.status}
        {/* Quote Cloudinary only when the words are its own (X-Cld-Error). */}
        {probe.source === 'x-cld-error' && <> · Cloudinary: {probe.message}</>}
      </span>
    );
  }
  if (probe.kind === 'network') return <span className="text-ink-3">unavailable · network</span>;

  const m = probe.metrics;
  const video = source.resourceType === 'video';
  const grab = components.find((c) => /^so_/.test(c));
  // Like with like: an image is compared with its stored original; a video still with the
  // frame Cloudinary grabbed from the video (Server-Timing's "original" for a so_ still).
  const baseline = video ? m.originalBytes : (m.originalBytes ?? source.bytes);
  const change = baseline && m.bytes ? Math.round((m.bytes / baseline - 1) * 100) : undefined;
  const enhanced = components.some((c) => c.startsWith('e_sharpen') || c.startsWith('e_improve'));
  const resized = Boolean(m.width && m.originalWidth && m.width < m.originalWidth);
  // Say where a difference comes from: growth from the evidence effects, savings partly from the resize.
  const reason =
    change === undefined
      ? undefined
      : change > 0
        ? enhanced
          ? 'sharpened for inspection'
          : undefined
        : resized
          ? 'resized + optimised'
          : 'optimised';

  return (
    <>
      {/* Wraps only between groups, never inside "176 KB" or "CDN hit". */}
      <span className="block text-ink-2">
        {video ? (
          <>
            <span className="sr-only">Source video </span>
            <G>
              <span className="uppercase">{source.format}</span> <span className="num">{formatBytes(source.bytes)}</span>
            </G>
            <Arrow />
            <span className="sr-only">, </span>
            <G>{grab ?? 'still'} frame grab</G>
            {m.originalBytes !== undefined && (
              <>
                {' '}
                <G>
                  {m.originalFormat && <span className="uppercase">{m.originalFormat} </span>}
                  <Dims width={m.originalWidth} height={m.originalHeight} />
                  <span className="num">{formatBytes(m.originalBytes)}</span>
                </G>
              </>
            )}
            <Arrow />
            <span className="sr-only">, delivered as </span>
          </>
        ) : (
          m.originalBytes !== undefined && (
            <>
              <G>
                {m.originalFormat ? <span className="uppercase">{m.originalFormat}</span> : 'original'}{' '}
                <Dims width={m.originalWidth} height={m.originalHeight} />
                <span className="num">{formatBytes(m.originalBytes)}</span>
              </G>
              <Arrow />
              <span className="sr-only"> delivered as </span>
            </>
          )
        )}
        <G>
          <span className="uppercase text-signal">{m.format ?? '—'}</span> <Dims width={m.width} height={m.height} />
          <span className="num text-ink">{formatBytes(m.bytes)}</span>
        </G>
      </span>
      <span className="mt-0.5 block text-ink-3">
        {change !== undefined && (
          <>
            <G>
              <span className={cn('num', change > 0 ? 'text-ink-2' : 'text-ok')}>
                {change > 0 ? '+' : change < 0 ? '−' : '±'}
                {Math.abs(change)}%
              </span>{' '}
              {video ? 'vs frame grab' : 'vs original'}
            </G>
            {reason && (
              <>
                <Sep />
                <G>{reason}</G>
              </>
            )}
            <Sep />
          </>
        )}
        {m.cache && (
          <>
            <G>CDN {m.cache}</G>
            <Sep />
          </>
        )}
        <span className="num whitespace-nowrap">{formatMs(m.elapsedMs)}</span>
      </span>
    </>
  );
}

/** A run of the delivery line that never wraps inside itself. */
function G({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap">{children}</span>;
}

/** "1920×1080 " when Cloudinary reported both dimensions. */
function Dims({ width, height }: { width?: number; height?: number }) {
  if (!width || !height) return null;
  return (
    <>
      <span className="num">
        {width}×{height}
      </span>{' '}
    </>
  );
}

/* Separators are where the line may wrap (the groups between them never do). */
function Arrow() {
  return (
    <>
      <span aria-hidden className="px-1.5 text-ink-3">
        →
      </span>
      <wbr />
    </>
  );
}

function Sep() {
  return (
    <>
      <span aria-hidden className="px-1.5 text-ink-3">
        ·
      </span>
      <wbr />
    </>
  );
}
