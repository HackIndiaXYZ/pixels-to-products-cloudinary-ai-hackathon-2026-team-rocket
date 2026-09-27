'use client';

import { motion } from 'framer-motion';
import { Film } from 'lucide-react';
import { memo, useRef } from 'react';
import type { MediaAsset } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/analytics';
import { thumbUrl } from '@/lib/cloudinary/media';
import { formatBytes, formatDuration } from '@/lib/format';
import { CloudImage } from '@/components/media/CloudImage';
import { SEVERITY_COLOR, SeverityDot } from '@/components/ui/badges';
import { ProvenanceBadge } from '@/components/ui/Provenance';
import { aiOnlyTerms, captureTimeDisplay } from './model';

const EASE = [0.16, 1, 0.3, 1] as const;
const HEAD = ['Media', 'Finding', 'Severity', 'Category', 'Location', 'Captured', 'Original'];

/**
 * Dense list view. The thumbnail shares the `media-<id>` layoutId with the
 * Inspector stage, so opening from a row morphs the frame just like the grid.
 * A record Cloudinary's AI has described shows its caption under the finding,
 * marked AI; when the search box matched only that AI text, the row says so.
 */
export const LibraryList = memo(function LibraryList({
  assets,
  now,
  query = '',
  selectedId,
  onOpen,
  onIntent,
}: {
  assets: MediaAsset[];
  now: number;
  /** The Library search box, to label matches found only in Cloudinary's AI understanding. */
  query?: string;
  selectedId: string | null;
  onOpen: (asset: MediaAsset) => void;
  onIntent: (asset: MediaAsset, stage: 'intent' | 'commit') => void;
}) {
  return (
    <div className="panel overflow-x-auto">
      <table className="w-full min-w-[860px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-line">
            {HEAD.map((h) => (
              <th key={h} scope="col" className="label px-3 py-2.5 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {assets.map((asset) => (
            <Row
              key={asset.id}
              asset={asset}
              now={now}
              aiMatch={aiOnlyTerms(asset, query).join(' ')}
              selected={selectedId === asset.id}
              onOpen={onOpen}
              onIntent={onIntent}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
});

const Row = memo(function Row({
  asset,
  now,
  aiMatch,
  selected,
  onOpen,
  onIntent,
}: {
  asset: MediaAsset;
  now: number;
  /** Search terms this row matched only in Cloudinary's AI understanding, space-separated ('' for none). */
  aiMatch: string;
  selected: boolean;
  onOpen: (asset: MediaAsset) => void;
  onIntent: (asset: MediaAsset, stage: 'intent' | 'commit') => void;
}) {
  const dwell = useRef(0);
  const finding = asset.finding;
  const isVideo = asset.resourceType === 'video';
  const captured = captureTimeDisplay(asset, now);
  const aiTerms = aiMatch ? aiMatch.split(' ') : [];
  return (
    <tr
      data-cursor="OPEN"
      className="group cursor-pointer transition-colors hover:bg-raised/70"
      onClick={() => onOpen(asset)}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        window.clearTimeout(dwell.current);
        dwell.current = window.setTimeout(() => onIntent(asset, 'intent'), 160);
      }}
      onPointerLeave={() => window.clearTimeout(dwell.current)}
      onPointerDown={(event) => {
        if (event.pointerType !== 'touch') onIntent(asset, 'commit');
      }}
    >
      <td className="px-3 py-2">
        <div className="flex items-center gap-3">
          <motion.span
            layoutId={`media-${asset.id}`}
            layoutDependency={selected}
            transition={{ layout: { duration: 0.46, ease: EASE } }}
            className="relative block h-10 w-16 shrink-0 overflow-hidden border border-line bg-raised"
            style={{ borderRadius: 5 }}
          >
            <CloudImage
              src={thumbUrl(asset, 128, 80)}
              srcSet={`${thumbUrl(asset, 64, 40)} 64w, ${thumbUrl(asset, 128, 80)} 128w`}
              sizes="64px"
              alt=""
              className="h-full w-full object-cover"
            />
            {isVideo && (
              <span className="absolute bottom-0.5 right-0.5 rounded-[3px] bg-canvas/85 p-0.5 text-ink-2">
                <Film className="h-2.5 w-2.5" />
              </span>
            )}
          </motion.span>
          <span className="min-w-0">
            <span className="block truncate font-mono text-[11.5px] text-ink-2">{asset.fileName}</span>
            <span className="num block font-mono text-[10.5px] text-ink-3">
              {asset.width}×{asset.height}
              {isVideo && asset.duration ? ` · ${formatDuration(asset.duration)}` : ''}
            </span>
          </span>
        </div>
      </td>
      <td className="max-w-[300px] px-3 py-2">
        <button
          type="button"
          data-asset-id={asset.id}
          className="block max-w-full truncate text-left font-medium text-ink decoration-line-strong underline-offset-4 group-hover:underline"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(asset);
          }}
        >
          {finding?.title ?? asset.title}
        </button>
        {finding && <span className="block font-mono text-[10.5px] text-ink-3">{finding.id}</span>}
        {asset.ai?.caption && (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5" title={`AI detected · Cloudinary caption: ${asset.ai.caption}`}>
            {aiTerms.length > 0 ? (
              <ProvenanceBadge kind="ai" detail="matched" className="py-0 text-[9.5px]" />
            ) : (
              <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.06em] text-signal/80">
                ai<span className="sr-only"> detected caption:</span>
              </span>
            )}
            <span className="min-w-0 truncate text-[11.5px] text-ink-3">{asset.ai.caption}</span>
          </span>
        )}
        {!asset.ai?.caption && aiTerms.length > 0 && (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <ProvenanceBadge kind="ai" detail="matched" className="py-0 text-[9.5px]" />
            <span className="min-w-0 truncate font-mono text-[10.5px] text-ink-3">{aiTerms.map((t) => `“${t}”`).join(' ')} · objects / auto-tags</span>
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        {finding ? (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.06em]" style={{ color: SEVERITY_COLOR[finding.severity] }}>
            <SeverityDot severity={finding.severity} />
            {finding.severity}
          </span>
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-ink-2">{finding ? CATEGORY_LABEL[finding.category] : <span className="text-ink-3">—</span>}</td>
      <td className="max-w-[220px] px-3 py-2">
        <span className="block truncate text-ink-2">{asset.site}</span>
        {asset.zone && <span className="block truncate text-[11.5px] text-ink-3">{asset.zone}</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2">
        <span className="num block font-mono text-[11.5px] text-ink-2">{captured.time}</span>
        <span className="num block font-mono text-[10.5px] text-ink-3">{captured.detail}</span>
      </td>
      <td className="num whitespace-nowrap px-3 py-2 font-mono text-[11.5px] text-ink-3">
        {asset.format.toUpperCase()} · {formatBytes(asset.bytes)}
      </td>
    </tr>
  );
});
