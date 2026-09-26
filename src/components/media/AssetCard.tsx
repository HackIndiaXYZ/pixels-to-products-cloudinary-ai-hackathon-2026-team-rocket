'use client';

import { motion } from 'framer-motion';
import { Film } from 'lucide-react';
import { useState } from 'react';
import type { MediaAsset } from '@/lib/types';
import { hoverClipUrl, thumbUrl } from '@/lib/cloudinary/media';
import { formatDuration, relativeTime } from '@/lib/format';
import { SEVERITY_COLOR, SeverityDot } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { CloudImage } from './CloudImage';
import { RegionLayer } from './RegionLayer';

/**
 * Library card. The thumbnail is a Cloudinary g_auto crop; hovering a video
 * plays a short Cloudinary-trimmed preview, hovering a photo reveals its
 * annotated region. The media frame morphs into the inspector (shared layout).
 */
export function AssetCard({
  asset,
  now,
  onOpen,
  selected = false,
}: {
  asset: MediaAsset;
  now: number;
  onOpen: (asset: MediaAsset) => void;
  selected?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const severity = asset.finding?.severity;
  const w = 640;
  const h = 400;

  return (
    <motion.button
      layout
      type="button"
      onClick={() => onOpen(asset)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      initial={{ scale: 0.98 }}
      animate={{ scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        'group flex flex-col rounded-[12px] p-1.5 text-left outline-offset-4 transition-colors',
        selected ? 'bg-raised' : 'hover:bg-surface',
      )}
    >
      <motion.div
        layoutId={`media-${asset.id}`}
        className="relative aspect-[16/10] w-full overflow-hidden rounded-[9px] border border-line bg-raised"
      >
        <CloudImage
          src={thumbUrl(asset, w, h)}
          srcSet={`${thumbUrl(asset, 400, 250)} 400w, ${thumbUrl(asset, w, h)} 640w, ${thumbUrl(asset, 960, 600)} 960w`}
          sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 90vw"
          alt={asset.title}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {asset.resourceType === 'video' && hover && (
          <video
            src={hoverClipUrl(asset, w, h)}
            autoPlay
            muted
            loop
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {asset.resourceType === 'image' && hover && asset.finding?.region && (
          <RegionLayer regions={[asset.finding.region]} variant="annotation" showLabels={false} />
        )}
        {severity && (
          <span
            className="absolute left-2 top-2 flex items-center gap-1.5 rounded-[6px] bg-canvas/85 px-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] backdrop-blur-sm"
            style={{ color: SEVERITY_COLOR[severity] }}
          >
            <SeverityDot severity={severity} />
            {severity}
          </span>
        )}
        {asset.resourceType === 'video' && (
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-[6px] bg-canvas/85 px-1.5 py-1 font-mono text-[10px] text-ink-2 backdrop-blur-sm">
            <Film className="h-3 w-3" />
            {asset.duration ? formatDuration(asset.duration) : 'VIDEO'}
          </span>
        )}
        {asset.source !== 'sample' && (
          <span className="absolute right-2 top-2 rounded-[6px] bg-signal px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em] text-signal-ink">
            {asset.source === 'upload' ? 'Uploaded' : 'Synced'}
          </span>
        )}
      </motion.div>
      <div className="px-1 pb-1 pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-mono text-[11px] text-ink-3">{asset.fileName}</span>
          <span className="shrink-0 font-mono text-[11px] text-ink-3">{relativeTime(asset.capturedAt, now)}</span>
        </div>
        <div className="mt-1 line-clamp-2 text-[13.5px] font-medium leading-snug tracking-[-0.005em] text-ink">
          {asset.finding?.title ?? asset.title}
        </div>
        <div className="mt-1 truncate text-[12px] text-ink-3">
          {asset.site}
          {asset.zone ? ` · ${asset.zone}` : ''}
        </div>
      </div>
    </motion.button>
  );
}
