'use client';

import { motion } from 'framer-motion';
import { ArrowRight, Film } from 'lucide-react';
import { memo } from 'react';
import type { MediaAsset } from '@/lib/types';
import { thumbUrl } from '@/lib/cloudinary/media';
import { formatDuration, relativeTime } from '@/lib/format';
import { CloudImage } from '@/components/media/CloudImage';
import { useReducedMotionPref } from '@/components/motion/hooks';
import { SEVERITY_COLOR } from '@/components/ui/badges';
import { useConsoleActions } from '../store';
import { EASE } from './shared';

/**
 * The latest field captures as a filmstrip; each frame opens the inspector.
 * Memoised; the callbacks are optional and default to the console's stable actions.
 */
export const RecentEvidence = memo(function RecentEvidence({
  assets,
  now,
  onInspect,
  onLibrary,
}: {
  assets: MediaAsset[];
  now: number;
  onInspect?: (assetId: string) => void;
  onLibrary?: () => void;
}) {
  const reduce = useReducedMotionPref();
  const actions = useConsoleActions();
  const inspect = onInspect ?? actions.inspect;
  const toLibrary = onLibrary ?? (() => actions.navigate('library'));
  if (!assets.length) return null;

  return (
    <section aria-labelledby="recent-evidence-title">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 id="recent-evidence-title" className="text-[13px] font-semibold text-ink">
            Recent evidence
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3">Latest captures, auto-cropped by Cloudinary (c_fill, g_auto)</p>
        </div>
        <button
          type="button"
          onClick={toLibrary}
          className="link-underline flex shrink-0 items-center gap-1 whitespace-nowrap text-[12px] text-ink-3 transition-colors hover:text-ink"
        >
          Open library <ArrowRight className="h-3 w-3" />
        </button>
      </div>

      <ul className="scrollbar-none -mx-4 mt-3 grid snap-x snap-mandatory scroll-px-4 auto-cols-[minmax(150px,1fr)] grid-flow-col gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:scroll-px-0 sm:px-0">
        {assets.map((asset, i) => {
          const severity = asset.finding?.severity;
          return (
            <motion.li
              key={asset.id}
              className="min-w-0 snap-start"
              initial={reduce ? false : { opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '0px 0px -6% 0px' }}
              transition={{ duration: 0.5, ease: EASE, delay: i * 0.05 }}
            >
              <button
                type="button"
                onClick={() => inspect(asset.id)}
                data-cursor="OPEN"
                aria-label={`Inspect ${asset.title}`}
                className="group block w-full text-left"
              >
                <span className="relative block aspect-[16/10] overflow-hidden rounded-[6px] border border-line bg-raised">
                  <CloudImage
                    src={thumbUrl(asset, 400, 250)}
                    srcSet={`${thumbUrl(asset, 320, 200)} 320w, ${thumbUrl(asset, 400, 250)} 400w, ${thumbUrl(asset, 640, 400)} 640w`}
                    sizes="(min-width: 1280px) 15vw, (min-width: 640px) 30vw, 150px"
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.035]"
                  />
                  {severity && (
                    <span
                      aria-hidden
                      className="absolute inset-x-0 top-0 h-[3px]"
                      style={{ backgroundColor: SEVERITY_COLOR[severity] }}
                    />
                  )}
                  {asset.resourceType === 'video' && (
                    <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-[4px] bg-canvas/85 px-1.5 py-0.5 font-mono text-[10px] text-ink">
                      <Film className="h-3 w-3" />
                      {asset.duration ? formatDuration(asset.duration) : 'Video'}
                    </span>
                  )}
                </span>
                <span className="mt-2 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[10.5px] text-ink-2">{asset.fileName}</span>
                  <span className="num shrink-0 font-mono text-[10.5px] text-ink-3">{relativeTime(asset.capturedAt, now)}</span>
                </span>
                <span className="mt-0.5 block truncate text-[12.5px] text-ink transition-colors group-hover:text-signal">{asset.title}</span>
                <span className="block truncate text-[11.5px] text-ink-3">
                  {asset.site}
                  {severity ? ` · ${severity}` : ''}
                </span>
              </button>
            </motion.li>
          );
        })}
      </ul>
    </section>
  );
});
