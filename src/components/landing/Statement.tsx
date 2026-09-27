'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import { useRef, useState, type ReactNode } from 'react';
import { easeInOutCubic, lerp, progressBetween } from '@/components/motion/hooks';
import { displaySrcSet, displayUrl, posterOffset } from '@/lib/cloudinary/media';
import { transformationFromUrl } from '@/lib/cloudinary/url';
import { cn } from '@/components/ui/cn';
import { MASK_LINE } from '@/components/motion/RevealText';
import { landingAsset } from './landing-data';
import { useReducedPref } from './story/hooks';

/**
 * Statement — a light, near-empty editorial pause between the hero and the
 * platform story. One sentence, one photograph that opens from a narrow crop
 * on a detail to the full frame, one answer.
 *
 * The photograph is deliberately not the hero's drone frame: a second capture
 * from the same dataset (the hot-work clip), so the first two screens show two
 * different kinds of field media.
 */

const EASE = [0.16, 1, 0.3, 1] as const;

const FRAME = landingAsset('vo-hot-work');
const FRAME_SRC = displayUrl(FRAME, 1600);
const FRAME_SRCSET = displaySrcSet(FRAME, [640, 960, 1280, 1600, 1920]);

/** The crop opens on the annotated detail (the welder at the hot work), then pulls back to the whole frame. */
const DETAIL = FRAME.finding?.region
  ? { x: FRAME.finding.region.x + FRAME.finding.region.w / 2, y: FRAME.finding.region.y + FRAME.finding.region.h / 2 }
  : { x: 50, y: 50 };
const START_SCALE = 1.3;
const SHIFT_X = START_SCALE * (50 - DETAIL.x);
const SHIFT_Y = START_SCALE * (50 - DETAIL.y);

export function Statement() {
  return (
    <section id="statement" aria-label="Every image contains evidence" className="theme-light relative">
      <div className="mx-auto max-w-[1320px] px-4 pb-[8vh] pt-[18vh] sm:px-6 lg:pt-[20vh]">
        <p className="label">The premise</p>
        <MaskedLines
          as="h2"
          className="type-display mt-8 text-[clamp(52px,10.4vw,180px)] leading-[0.92] text-ink"
          label="Every image contains evidence."
          lines={[
            { content: 'Every image' },
            { content: 'contains', className: 'pl-[16%]' },
            {
              content: (
                <>
                  evidence<span className="text-signal">.</span>
                </>
              ),
              className: 'pl-[5%]',
            },
          ]}
        />
      </div>

      <GrowingFrame />

      <div className="mx-auto max-w-[1320px] px-4 pb-[16vh] pt-[12vh] sm:px-6">
        <MaskedLines
          as="h2"
          className="type-display text-[clamp(40px,7vw,122px)] leading-[0.95] text-ink lg:pl-[25%]"
          label="VisualOps makes it searchable."
          lines={[{ content: 'VisualOps makes' }, { content: 'it searchable.' }]}
        />
        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '0px 0px -10% 0px' }}
          transition={{ duration: 0.6, delay: 0.15, ease: EASE }}
          className="mt-8 max-w-[38ch] text-[15.5px] leading-relaxed text-ink-2 lg:ml-[25%]"
        >
          A void at a kerb line, a gas cylinder beside live welding, a red light on a dashboard — already photographed, then lost in a
          camera roll. Your team logs what each frame shows, Cloudinary adds subject-aware crops and face detection, and VisualOps
          structures and indexes both, so every frame can be found when it matters.
        </motion.p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */

function MaskedLines({
  as: Tag,
  lines,
  label,
  className,
}: {
  as: 'h2' | 'p';
  lines: Array<{ content: ReactNode; className?: string }>;
  label: string;
  className?: string;
}) {
  return (
    <Tag className={className}>
      <span className="sr-only">{label}</span>
      {lines.map((line, i) => (
        // The mask is observed (it is on screen); the clipped line inherits the variant.
        <motion.span
          key={i}
          aria-hidden
          className={cn('block overflow-hidden pb-[0.07em] -mb-[0.07em]', line.className)}
          initial="hidden"
          whileInView="shown"
          viewport={{ once: true, margin: '0px 0px -14% 0px' }}
        >
          <motion.span className="block" variants={MASK_LINE} transition={{ duration: 1.05, delay: i * 0.12, ease: EASE }}>
            {line.content}
          </motion.span>
        </motion.span>
      ))}
    </Tag>
  );
}

/* ------------------------------------------------------------------------ */

/**
 * One photograph, one clip-path: a narrow centred crop on the detail that
 * widens to full-bleed as the section scrolls. Transform + clip-path only,
 * both driven by motion values (no React renders while scrolling).
 *
 * Reduced motion: a plain, static full-bleed figure. The layout comes from the
 * CSS `motion-reduce:` / `motion-safe:` variants, so it is right from the
 * server-rendered first paint (no overlap with the headline, no sticky hold);
 * the motion values are simply not bound once the preference is known.
 */
function GrowingFrame() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedPref();
  const [usedSrc, setUsedSrc] = useState(FRAME_SRC);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end end'] });
  // Wrapper is 120vh: the frame pins at ~0.83 and is full-bleed shortly after, then holds.
  const t = useTransform(scrollYProgress, (v) => easeInOutCubic(progressBetween(v, 0.42, 0.92)));
  const clipPath = useTransform(t, (v) => {
    const k = (1 - v).toFixed(4);
    return `inset(calc(var(--iy) * ${k}) calc(var(--ix) * ${k}) calc(var(--iy) * ${k}) calc(var(--ix) * ${k}) round ${lerp(6, 0, v).toFixed(2)}px)`;
  });
  const imageTransform = useTransform(t, (v) => {
    const k = 1 - v;
    return `translate3d(calc(var(--detail) * ${(SHIFT_X * k).toFixed(3)}%), calc(var(--detail) * ${(SHIFT_Y * k).toFixed(3)}%), 0) scale(${lerp(START_SCALE, 1, v).toFixed(4)})`;
  });
  const captionOpacity = useTransform(t, [0.7, 1], [0, 1]);

  const transformation = transformationFromUrl(usedSrc).join(' / ');

  return (
    // The clipped (transparent) top of the frame tucks under the heading's bottom padding —
    // only while it is clipped, i.e. never under reduced motion.
    <div ref={ref} className="relative h-[120vh] motion-safe:-mt-[16vh] motion-reduce:h-auto">
      <div className="sticky top-0 flex h-[100svh] flex-col justify-center overflow-hidden motion-reduce:static motion-reduce:h-auto">
        <motion.div
          className={cn(
            'relative h-[64svh] w-full overflow-hidden bg-raised [--detail:0] [--ix:24%] [--iy:14%] md:h-auto md:flex-1 md:[--detail:1] md:[--ix:36%] md:[--iy:16%]',
            // Static figure: full-bleed at the frame's own aspect, capped to the viewport.
            'motion-reduce:aspect-video motion-reduce:h-auto motion-reduce:max-h-[82svh] motion-reduce:flex-none motion-reduce:[clip-path:none]!',
          )}
          style={reduced ? undefined : { clipPath }}
        >
          <motion.img
            src={FRAME_SRC}
            srcSet={FRAME_SRCSET}
            sizes="100vw"
            alt={`Video frame from ${FRAME.fileName}: a welder in a helmet and gloves MIG-welding a steel fabrication, a gas cylinder standing close behind, in the ${FRAME.zone?.toLowerCase() ?? 'maintenance bay'} at ${FRAME.site}`}
            loading="lazy"
            decoding="async"
            onLoad={(e) => setUsedSrc(e.currentTarget.currentSrc || FRAME_SRC)}
            className="absolute inset-0 h-full w-full object-cover motion-reduce:transform-none!"
            style={reduced ? undefined : { transform: imageTransform }}
          />
        </motion.div>
        <motion.div
          style={reduced ? undefined : { opacity: captionOpacity }}
          className="flex flex-col gap-1 px-4 py-3 font-mono text-[11px] text-ink-3 motion-reduce:opacity-100! sm:px-6 md:flex-row md:items-center md:justify-between md:gap-6"
        >
          <span>
            <span className="text-ink-2">{FRAME.fileName}</span> · frame so_{posterOffset(FRAME)} · {FRAME.site}
            {FRAME.zone ? ` · ${FRAME.zone}` : ''}
          </span>
          <span className="truncate md:text-right">
            Cloudinary · {transformation} · original {FRAME.width}×{FRAME.height}
          </span>
        </motion.div>
      </div>
    </div>
  );
}
