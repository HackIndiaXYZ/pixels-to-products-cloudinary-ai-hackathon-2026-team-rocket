'use client';

import { ArrowRight } from 'lucide-react';
import type { ProbeResult } from '@/lib/cloudinary/probe';
import { formatBytes, formatMs } from '@/lib/format';
import { cn } from '@/components/ui/cn';

/**
 * What Cloudinary actually delivered, read from its Server-Timing header:
 * original bytes/format → delivered bytes/format, processing time, cache.
 */
export function DeliveryReceipt({
  result,
  className,
  label = 'Delivered by Cloudinary',
  compact = false,
}: {
  result: ProbeResult | undefined;
  className?: string;
  label?: string;
  compact?: boolean;
}) {
  if (!result || result.kind !== 'ready') {
    return (
      <div className={cn('text-[12px] text-ink-3', className)}>
        {result && result.kind !== 'processing' ? 'No delivery data' : 'Measuring…'}
      </div>
    );
  }
  const m = result.metrics;
  const saved = m.originalBytes && m.bytes ? 1 - m.bytes / m.originalBytes : undefined;
  if (compact) {
    return (
      <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-ink-2', className)}>
        <span className="uppercase">{m.format ?? '—'}</span>
        <span className="num">{formatBytes(m.bytes)}</span>
        {saved !== undefined && saved > 0.005 && <span className="num text-signal">−{Math.round(saved * 100)}%</span>}
      </div>
    );
  }
  return (
    <div className={cn('space-y-2', className)}>
      <div className="label">{label}</div>
      <div className="flex flex-wrap items-center gap-2 font-mono text-[12px]">
        <span className="text-ink-3">
          <span className="uppercase">{m.originalFormat ?? '—'}</span> <span className="num">{formatBytes(m.originalBytes)}</span>
          {m.originalWidth ? <span className="num"> · {m.originalWidth}×{m.originalHeight}</span> : null}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-ink-3" />
        <span className="text-ink">
          <span className="uppercase">{m.format ?? '—'}</span> <span className="num">{formatBytes(m.bytes)}</span>
          {m.width ? <span className="num text-ink-2"> · {m.width}×{m.height}</span> : null}
        </span>
        {saved !== undefined && (
          <span className={cn('num rounded-[5px] px-1.5 py-0.5', saved > 0 ? 'bg-[color-mix(in_oklab,var(--color-signal)_14%,transparent)] text-signal' : 'bg-raised text-ink-2')}>
            {saved > 0 ? '−' : '+'}
            {Math.abs(Math.round(saved * 100))}%
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-ink-3">
        {m.cache && <span>CDN {m.cache}</span>}
        {m.transformMs !== undefined && <span className="num">transform {formatMs(m.transformMs)}</span>}
        {m.cloudinaryMs !== undefined && <span className="num">origin {formatMs(m.cloudinaryMs)}</span>}
        <span className="num">round-trip {formatMs(m.elapsedMs)}</span>
      </div>
    </div>
  );
}
