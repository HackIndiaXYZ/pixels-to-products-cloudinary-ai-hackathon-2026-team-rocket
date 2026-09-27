'use client';

import { motion } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { IMAGE_ACCEPT, type ProbeResult } from '@/lib/cloudinary/probe';
import { useElapsed, useProbe } from '@/components/media/useProbe';
import { cn } from '@/components/ui/cn';

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * What Cloudinary is doing with a URL right now — rendering, processing an
 * asynchronous AI transformation (HTTP 423), or refusing it (X-Cld-Error).
 * Flat chip, no blur: it sits on top of media.
 */
export function StatusChip({ result, loading, className }: { result: ProbeResult | undefined; loading: boolean; className?: string }) {
  const failed = result && (result.kind === 'error' || result.kind === 'network');
  const busy = !failed && (loading || !result || result.kind === 'processing');
  const elapsed = useElapsed(busy);
  if (!failed && !busy) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none absolute bottom-3 left-3 z-20 flex max-w-[calc(100%-24px)] items-center gap-2 rounded-[5px] border border-line-strong bg-canvas/92 px-2 py-1 font-mono text-[10.5px] text-ink-2',
        className,
      )}
    >
      {failed ? (
        <>
          <AlertTriangle className="h-3 w-3 shrink-0 text-critical" />
          <span className="truncate">
            {result.kind === 'network'
              ? 'Could not reach Cloudinary'
              : result.source === 'x-cld-error'
                ? `HTTP ${result.status} · Cloudinary: ${result.message}`
                : result.source === 'status'
                  ? `Cloudinary answered HTTP ${result.status}`
                  : result.message}
          </span>
        </>
      ) : (
        <>
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 animate-pulse-dot rounded-full bg-signal" />
          <span className="truncate">
            {result?.kind === 'processing'
              ? 'Cloudinary is rendering this AI transformation · HTTP 423 · retrying'
              : result
                ? 'Downloading from Cloudinary'
                : 'Requesting from Cloudinary'}
          </span>
          <span className="num shrink-0 text-ink-3">{elapsed.toFixed(1)}s</span>
        </>
      )}
    </div>
  );
}

/**
 * An image rendered only after Cloudinary confirms the URL (HEAD 200), so
 * asynchronous AI transformations wait through HTTP 423 instead of breaking.
 * While a new URL loads, the previous one stays on screen and the new one
 * fades in over it. `onReady` fires when the pixels have actually arrived.
 */
export function ProbedImg({
  url,
  alt,
  enabled = true,
  fit = 'cover',
  className,
  imgClassName,
  onReady,
  status = true,
}: {
  url: string;
  alt: string;
  enabled?: boolean;
  fit?: 'cover' | 'contain';
  className?: string;
  imgClassName?: string;
  onReady?: () => void;
  status?: boolean;
}) {
  const result = useProbe(url, { accept: IMAGE_ACCEPT, enabled });
  const [shown, setShown] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  const ready = result?.kind === 'ready';
  const loading = ready && shown !== url && failed !== url;
  const objectFit = fit === 'cover' ? 'object-cover' : 'object-contain';

  return (
    <div className={cn('absolute inset-0', className)}>
      {shown && (
        <motion.div
          key={shown}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.35, ease: EASE }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
          <img
            src={shown}
            alt={alt}
            draggable={false}
            decoding="async"
            className={cn('absolute inset-0 h-full w-full select-none', objectFit, imgClassName)}
          />
        </motion.div>
      )}
      {loading && (
        // eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition
        <img
          key={url}
          src={url}
          alt=""
          aria-hidden
          draggable={false}
          decoding="async"
          onLoad={() => {
            setShown(url);
            onReadyRef.current?.();
          }}
          onError={() => setFailed(url)}
          className={cn('absolute inset-0 h-full w-full opacity-0', objectFit)}
        />
      )}
      {status && enabled && (
        <StatusChip
          result={failed === url ? { kind: 'error', status: 0, message: 'The browser could not decode this response' } : result}
          loading={loading}
        />
      )}
    </div>
  );
}
