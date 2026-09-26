'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import type { ProbeResult } from '@/lib/cloudinary/probe';
import { cn } from '@/components/ui/cn';
import { useElapsed } from './useProbe';

/**
 * What the overlay reports on. Besides Cloudinary's probe result, the browser
 * itself can fail to decode a file Cloudinary delivered with HTTP 200.
 */
export type RenderState = ProbeResult | { kind: 'decode' };

/**
 * Where the render comes from:
 * - `pipeline` — a transformation chain the user is editing (Studio), so a
 *   failure can be fixed by adjusting a step;
 * - `asset` — a fixed rendition of a record (Inspector, previews).
 */
export type RenderContext = 'pipeline' | 'asset';

/** True only when the failure text is Cloudinary's own X-Cld-Error header (never for a missing `source`). */
function fromCloudinary(result: Extract<ProbeResult, { kind: 'error' }>): boolean {
  return result.source === 'x-cld-error';
}

function statusHint(status: number): string {
  if (status === 404) return 'Nothing is delivered at this URL — the asset may have been renamed or removed.';
  if (status === 401 || status === 403) return 'This cloud refused the delivery (restricted media or strict transformations).';
  if (status === 420) return 'This cloud has reached a Cloudinary usage limit for this kind of transformation.';
  if (status >= 500) return 'Cloudinary reported a server error. Retrying later usually resolves it.';
  return 'Cloudinary sent no X-Cld-Error explanation with this status.';
}

function describe(result: Exclude<RenderState, { kind: 'ready' } | { kind: 'processing' }>, context: RenderContext) {
  if (result.kind === 'network') {
    return {
      title: 'Could not reach Cloudinary',
      detail: result.message,
      note: 'Check the connection, or whether a browser extension blocks res.cloudinary.com.',
      mono: true,
    };
  }
  if (result.kind === 'decode') {
    return {
      title: 'The browser could not decode the delivered file',
      detail: 'Cloudinary answered, but this browser cannot display the file it returned.',
      note: context === 'pipeline' ? 'Try another output format, or adjust or remove the step that sets it.' : undefined,
      mono: false,
    };
  }
  if (fromCloudinary(result)) {
    return {
      title: `Cloudinary answered HTTP ${result.status}`,
      detail: `Cloudinary says: ${result.message}`,
      note: context === 'pipeline' ? 'Adjust or remove the step that triggers it.' : undefined,
      mono: true,
    };
  }
  return {
    title: `Cloudinary answered HTTP ${result.status}`,
    detail: statusHint(result.status),
    note: context === 'pipeline' ? 'If a step you added causes it, adjust or remove that step.' : undefined,
    mono: false,
  };
}

/** Overlay describing what Cloudinary is doing with a URL right now. */
export function RenderStatus({
  result,
  loading,
  className,
  compact = false,
  context = 'asset',
}: {
  result: RenderState | undefined;
  loading: boolean;
  className?: string;
  compact?: boolean;
  context?: RenderContext;
}) {
  const busy = loading || !result || result.kind === 'processing';
  const elapsed = useElapsed(busy);

  if (result && (result.kind === 'error' || result.kind === 'network' || result.kind === 'decode')) {
    const copy = describe(result, context);
    return (
      <div className={cn('absolute inset-0 flex items-center justify-center bg-canvas/85 p-4', className)}>
        <div
          role="status"
          className="max-w-sm rounded-[10px] border border-[color-mix(in_oklab,var(--color-critical)_40%,transparent)] bg-surface p-4"
        >
          <div className="flex items-start gap-2 text-[13px] font-medium text-critical">
            <AlertTriangle aria-hidden className="mt-px h-4 w-4 shrink-0" />
            <span>{copy.title}</span>
          </div>
          <p className={cn('mt-1.5 leading-relaxed text-ink-2', copy.mono ? 'break-words font-mono text-[11.5px]' : 'text-[12.5px]')}>
            {copy.detail}
          </p>
          {copy.note && <p className="mt-2 text-[12px] text-ink-3">{copy.note}</p>}
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
        'pointer-events-none absolute flex items-center gap-2 rounded-[8px] border border-line-strong bg-canvas px-2.5 py-1.5 text-[12px] text-ink-2',
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
