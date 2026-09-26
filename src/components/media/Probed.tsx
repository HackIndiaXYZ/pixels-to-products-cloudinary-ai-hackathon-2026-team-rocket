'use client';

import { useState } from 'react';
import { IMAGE_ACCEPT } from '@/lib/cloudinary/probe';
import { cn } from '@/components/ui/cn';
import { RenderStatus } from './RenderStatus';
import { useProbe } from './useProbe';

/**
 * Renders a Cloudinary image only once Cloudinary confirms it (HEAD 200),
 * waiting through HTTP 423 for asynchronous AI work. While a new URL renders,
 * the previous result stays on screen.
 */
export function ProbedImage({
  url,
  alt,
  className,
  fit = 'contain',
  showStatus = true,
}: {
  url: string;
  alt: string;
  className?: string;
  fit?: 'contain' | 'cover';
  showStatus?: boolean;
}) {
  const result = useProbe(url, { accept: IMAGE_ACCEPT });
  const [shown, setShown] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const ready = result?.kind === 'ready';
  const loading = ready && shown !== url && failed !== url;
  const objectFit = fit === 'cover' ? 'object-cover' : 'object-contain';

  return (
    <div className={cn('relative h-full w-full', className)}>
      {shown && (
        // eslint-disable-next-line @next/next/no-img-element -- exact Cloudinary URL under test.
        <img
          src={shown}
          alt={alt}
          draggable={false}
          className={cn('absolute inset-0 h-full w-full select-none transition-opacity duration-300', objectFit, loading && 'opacity-60')}
        />
      )}
      {ready && shown !== url && failed !== url && (
        // eslint-disable-next-line @next/next/no-img-element -- exact Cloudinary URL under test.
        <img
          key={url}
          src={url}
          alt=""
          aria-hidden
          draggable={false}
          onLoad={() => setShown(url)}
          onError={() => setFailed(url)}
          className={cn('absolute inset-0 h-full w-full opacity-0', objectFit)}
        />
      )}
      {showStatus && (
        <RenderStatus
          result={failed === url ? { kind: 'error', status: 0, message: 'The browser could not decode this response.' } : result}
          loading={loading}
        />
      )}
    </div>
  );
}

export function ProbedVideo({
  url,
  poster,
  className,
  autoPlay = false,
  loop = false,
  controls = true,
  onDuration,
  videoRef,
}: {
  url: string;
  poster?: string;
  className?: string;
  autoPlay?: boolean;
  loop?: boolean;
  controls?: boolean;
  onDuration?: (seconds: number) => void;
  videoRef?: React.Ref<HTMLVideoElement>;
}) {
  const result = useProbe(url);
  const [ready, setReady] = useState<string | null>(null);
  const confirmed = result?.kind === 'ready';

  return (
    <div className={cn('relative h-full w-full bg-black', className)}>
      {confirmed ? (
        <video
          key={url}
          ref={videoRef}
          src={url}
          poster={poster}
          controls={controls}
          autoPlay={autoPlay}
          muted={autoPlay}
          loop={loop}
          playsInline
          preload="metadata"
          onLoadedMetadata={(event) => {
            setReady(url);
            const d = event.currentTarget.duration;
            if (Number.isFinite(d)) onDuration?.(d);
          }}
          className="absolute inset-0 h-full w-full object-contain"
        />
      ) : (
        poster && (
          // eslint-disable-next-line @next/next/no-img-element -- Cloudinary video poster frame.
          <img src={poster} alt="" aria-hidden className="absolute inset-0 h-full w-full object-contain opacity-50" />
        )
      )}
      <RenderStatus result={result} loading={confirmed && ready !== url} />
    </div>
  );
}
