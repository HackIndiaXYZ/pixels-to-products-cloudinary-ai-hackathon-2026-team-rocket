'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import type { ProbeResult } from '@/lib/cloudinary/probe';
import { cn } from '@/components/ui/cn';
import { useElapsed } from './useProbe';

/** Overlay describing what Cloudinary is doing with a URL right now. */
export function RenderStatus({
  result,
  loading,
  className,
  compact = false,
}: {
  result: ProbeResult | undefined;
  loading: boolean;
  className?: string;
  compact?: boolean;
}) {
  const busy = loading || !result || result.kind === 'processing';
  const elapsed = useElapsed(busy);

  if (result && (result.kind === 'error' || result.kind === 'network')) {
    return (
      <div className={cn('absolute inset-0 flex items-center justify-center bg-canvas/85 p-4', className)}>
        <div className="max-w-sm rounded-[10px] border border-[color-mix(in_oklab,var(--color-critical)_40%,transparent)] bg-surface p-4">
          <div className="flex items-center gap-2 text-[13px] font-medium text-critical">
            <AlertTriangle className="h-4 w-4" />
            {result.kind === 'network' ? 'Could not reach Cloudinary' : `Cloudinary answered HTTP ${result.status}`}
          </div>
          <p className="mt-1.5 font-mono text-[11.5px] leading-relaxed text-ink-2">{result.message}</p>
          <p className="mt-2 text-[12px] text-ink-3">
            This is Cloudinary’s own error message (X-Cld-Error). Adjust or remove the step that triggers it.
          </p>
        </div>
      </div>
    );
  }

  if (!busy) return null;

  const processing = result?.kind === 'processing';
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none absolute flex items-center gap-2 rounded-[8px] border border-line-strong bg-canvas/90 px-2.5 py-1.5 text-[12px] text-ink-2 backdrop-blur-sm',
        compact ? 'bottom-2 left-2' : 'bottom-3 left-3',
        className,
      )}
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-signal" />
      <span>
        {processing
          ? 'Cloudinary is processing this AI transformation (HTTP 423) — retrying'
          : result
            ? 'Downloading from Cloudinary'
            : 'Rendering on Cloudinary'}
      </span>
      <span className="num font-mono text-[11px] text-ink-3">{elapsed.toFixed(1)}s</span>
    </div>
  );
}
