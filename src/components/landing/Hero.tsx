'use client';

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion';
import Link from 'next/link';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { evidenceUrl, rawStillUrl } from '@/lib/cloudinary/media';
import { fetchInsight, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import { IMAGE_ACCEPT, measure } from '@/lib/cloudinary/probe';
import { formatBytes } from '@/lib/format';
import { RegionLayer } from '@/components/media/RegionLayer';
import { LiveDot } from '@/components/ui/badges';
import { landingAsset } from './landing-data';

const HERO = landingAsset('vo-demolition-deck');
const PROOF_IDS = ['vo-demolition-deck', 'vo-road-collapse', 'vo-crew-ppe', 'vo-receiving-label', 'vo-bridge-truss', 'vo-fleet-checkin'];

export function Hero() {
  const reduce = useReducedMotion();
  const frameRef = useRef<HTMLDivElement>(null);
  const split = useMotionValue(reduce ? 50 : 100);
  const clip = useTransform(split, (v) => `inset(0 0 0 ${v}%)`);
  const lineLeft = useTransform(split, (v) => `${v}%`);
  const [insight, setInsight] = useState<CloudinaryInsight | null>(null);
  const [proof, setProof] = useState<{ original: number; delivered: number; count: number } | null>(null);

  const rawUrl = rawStillUrl(HERO, 1600);
  const processedUrl = evidenceUrl(HERO, 1600);

  // One slow sweep reveals the Cloudinary rendition, then the cursor takes over.
  useEffect(() => {
    if (reduce) return;
    const controls = animate(split, 38, { duration: 2.2, delay: 0.6, ease: [0.16, 1, 0.3, 1] });
    return () => controls.stop();
  }, [reduce, split]);

  useEffect(() => {
    let cancelled = false;
    fetchInsight(HERO).then((i) => !cancelled && setInsight(i)).catch(() => undefined);
    // Live proof: what Cloudinary actually delivers for the stills on this page.
    Promise.all(
      PROOF_IDS.map((id) => measure(evidenceUrl(landingAsset(id), 1600), { accept: IMAGE_ACCEPT })),
    ).then((results) => {
      if (cancelled) return;
      let original = 0;
      let delivered = 0;
      let count = 0;
      for (const r of results) {
        if (r.kind === 'ready' && r.metrics.originalBytes && r.metrics.bytes) {
          original += r.metrics.originalBytes;
          delivered += r.metrics.bytes;
          count += 1;
        }
      }
      if (count) setProof({ original, delivered, count });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onPointerMove = (event: React.PointerEvent) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return;
    split.stop();
    split.set(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)));
  };

  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="survey-grid fade-mask-b pointer-events-none absolute inset-0 opacity-50" />
      <div className="relative mx-auto grid max-w-[1320px] gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-center lg:gap-14 lg:pb-24 lg:pt-20">
        <div>
          <motion.p
            initial={{ y: 8 }}
            animate={{ y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="label"
          >
            Pixels to Products · Cloudinary AI Hackathon 2026 · Track 1 — AI Media Pipelines
          </motion.p>
          <h1 className="mt-5 text-[44px] font-semibold leading-[1.02] tracking-[-0.045em] text-ink sm:text-[58px] lg:text-[66px]">
            Turn visual data into operational intelligence.
          </h1>
          <p className="mt-6 max-w-[34rem] text-[16.5px] leading-relaxed text-ink-2">
            Field photos, drone footage and CCTV pile up with nothing but a file name. VisualOps runs every frame through Cloudinary —
            understanding, structuring and indexing it — so teams can search their media, see where risk is, and act on it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/console" className="btn btn-primary h-11 px-5 text-[14px]">
              Open the console <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="#pipeline" className="btn btn-secondary h-11 px-5 text-[14px]">
              See the pipeline <ArrowDown className="h-4 w-4" />
            </a>
          </div>
          <p className="mt-7 flex max-w-[34rem] items-start gap-2 text-[13px] leading-relaxed text-ink-3">
            <LiveDot className="mt-1.5" />
            <span>
              {proof ? (
                <>
                  Measured just now from Cloudinary: {proof.count} evidence frames on this page come from{' '}
                  <span className="num text-ink-2">{formatBytes(proof.original)}</span> of originals, delivered as{' '}
                  <span className="num text-signal">{formatBytes(proof.delivered)}</span> (−{Math.round((1 - proof.delivered / proof.original) * 100)}%).
                </>
              ) : (
                'Measuring what Cloudinary delivers for this page…'
              )}
            </span>
          </p>
        </div>

        {/* Inspection frame */}
        <div className="relative">
          <div
            ref={frameRef}
            onPointerMove={onPointerMove}
            className="relative aspect-video w-full cursor-ew-resize select-none overflow-hidden rounded-[14px] border border-line-strong bg-raised shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)]"
            role="img"
            aria-label="Drone frame of a demolition deck: raw capture compared with Cloudinary's evidence rendition. Move the pointer to compare."
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary frame grab */}
            <img src={rawUrl} alt="" className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" />
            <motion.div className="absolute inset-0" style={{ clipPath: clip }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary evidence rendition */}
              <img src={processedUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
            </motion.div>
            {HERO.finding?.region && <RegionLayer regions={[HERO.finding.region]} variant="annotation" />}
            {insight?.focus && <RegionLayer regions={[{ ...insight.focus, label: 'CLOUDINARY g_auto' }]} variant="focus" />}
            <motion.div className="pointer-events-none absolute inset-y-0 w-px bg-signal" style={{ left: lineLeft }}>
              <span className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-[5px] bg-signal px-1.5 py-0.5 font-mono text-[9.5px] font-semibold tracking-[0.06em] text-signal-ink">
                RAW | CLOUDINARY
              </span>
            </motion.div>
            <span className="reticle" />
          </div>
          <div className="mt-3 grid gap-2 font-mono text-[11px] text-ink-3 sm:grid-cols-[auto_1fr] sm:gap-6">
            <span>
              <span className="text-ink-2">{HERO.fileName}</span> · frame 00:0{HERO.posterOffset} · {HERO.site}
            </span>
            <span className="truncate sm:text-right">
              so_{HERO.posterOffset} / c_limit,w_1600 / e_improve / e_sharpen:60 / q_auto / f_auto
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
