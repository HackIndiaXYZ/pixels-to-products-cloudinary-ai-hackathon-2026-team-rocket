'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { CATEGORY_LABEL } from '@/lib/analytics';
import { displayUrl, thumbUrl } from '@/lib/cloudinary/media';
import { CROP_LABEL, fetchInsight, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import { RegionLayer } from '@/components/media/RegionLayer';
import { SeverityBadge } from '@/components/ui/badges';
import { landingAsset } from '../landing-data';
import { EVIDENCE_SRC, GROUPS_LOW, HERO, QUERY_RESULT, STAGES, TILES_LOW } from './data';
import { useReportHash } from './hooks';
import { mulberry32 } from './layout';
import { ActionPanel, InsightLegend, InsightPanel, QueryPanel, RecordPanel, ReportSheet } from './parts';

/**
 * Reduced-motion version of the platform story: no pinning, no scroll-driven
 * motion — the six stages as a readable narrative, each with the key visual
 * state the animated scene arrives at.
 */

const pad = (n: number) => String(n).padStart(2, '0');

export function StoryStatic() {
  const hash = useReportHash(EVIDENCE_SRC);

  const visuals: ReactNode[] = [
    <PileStill key="raw" />,
    <UnderstandStill key="understand" />,
    <StructureStill key="structure" />,
    <SearchStill key="search" />,
    <InsightStill key="insight" />,
    <div key="action" className="grid grid-cols-1 items-start gap-8 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
      <ReportSheet evidenceSrc={EVIDENCE_SRC} hash={hash} />
      <ActionPanel />
    </div>,
  ];

  return (
    <section id="platform" aria-label="The VisualOps platform, in six stages" className="relative border-t border-line bg-canvas">
      <div className="mx-auto max-w-[1320px] px-4 py-24 sm:px-6 lg:py-32">
        <div className="max-w-2xl">
          <p className="label">The platform · six stages</p>
          <h2 className="type-display mt-4 text-[40px] text-ink sm:text-[56px]">From a camera roll to a decision.</h2>
        </div>
        <ol className="mt-16 border-t border-line">
          {STAGES.map((s, k) => (
            <li
              key={s.id}
              className="grid grid-cols-1 gap-10 border-b border-line py-14 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)] lg:gap-16 lg:py-20"
            >
              <div className="min-w-0">
                <p className="num font-mono text-[12px] text-signal">
                  {pad(k + 1)} <span className="text-ink-3">/ {pad(STAGES.length)}</span>
                </p>
                <p
                  aria-hidden
                  className="type-poster mt-4 text-[clamp(44px,6.4vw,96px)] text-ink"
                >
                  {s.word}
                </p>
                <h3 className="sr-only">{s.title}</h3>
                <p className="mt-6 max-w-md text-[16px] leading-relaxed text-ink-2">{s.body}</p>
                <p className="mt-3 font-mono text-[11px] text-ink-3">{s.tech}</p>
              </div>
              <div className="min-w-0">{visuals[k]}</div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* 01 · a still pile of captures ---------------------------------------- */

const PILE = TILES_LOW.slice(0, 9).map((spec, i) => {
  const rand = mulberry32(0xa11ce + i * 101);
  const col = i % 3;
  const row = Math.floor(i / 3);
  return {
    spec,
    left: 4 + col * 31 + (rand() - 0.5) * 8,
    top: 4 + row * 30 + (rand() - 0.5) * 8,
    width: 26 + rand() * 8,
    rotate: (rand() * 2 - 1) * 9,
  };
});

function PileStill() {
  return (
    <div className="relative aspect-[16/11] overflow-hidden rounded-[8px] border border-line bg-surface">
      {PILE.map(({ spec, left, top, width, rotate }) => (
        <figure
          key={spec.key}
          className="absolute"
          style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, transform: `rotate(${rotate.toFixed(1)}deg)` }}
        >
          <div className="overflow-hidden rounded-[3px] bg-raised ring-1 ring-inset ring-white/10" style={{ aspectRatio: String(spec.aspect) }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
            <img src={spec.src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
          </div>
          <figcaption className="mt-1 truncate font-mono text-[9.5px] text-ink-3">{spec.caption}</figcaption>
        </figure>
      ))}
    </div>
  );
}

/* 02 · live Cloudinary signals on one capture ------------------------------ */

const CREW = landingAsset('vo-crew-ppe');

function UnderstandStill() {
  const [insight, setInsight] = useState<CloudinaryInsight | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchInsight(CREW)
      .then((i) => {
        if (!cancelled) setInsight(i);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return (
    <div>
      <div className="relative w-full overflow-hidden rounded-[8px] border border-line bg-raised" style={{ aspectRatio: `${CREW.width} / ${CREW.height}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
        <img
          src={displayUrl(CREW, 1200)}
          alt="Crew reviewing drawings beside a mobile scaffold"
          loading="lazy"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
        />
        {CREW.finding?.region && <RegionLayer regions={[CREW.finding.region]} variant="annotation" />}
        {insight?.focus && <RegionLayer regions={[{ ...insight.focus, label: `${CROP_LABEL} (1:1)` }]} variant="focus" />}
        {insight && <RegionLayer regions={insight.faces} variant="face" />}
      </div>
      <p className="mt-2 font-mono text-[11px] text-ink-3">{CREW.fileName}</p>
      <InsightLegend insights={insight ? { [CREW.id]: insight } : {}} />
    </div>
  );
}

/* 03 · records grouped by category ------------------------------------------ */

function StructureStill() {
  return (
    <div className="grid grid-cols-1 gap-10 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.65fr)]">
      <CategoryColumns />
      <RecordPanel />
    </div>
  );
}

function CategoryColumns() {
  return (
    // Six columns only where they are wide enough for the category names; three beside the record (xl).
    <div className="grid grid-cols-3 gap-x-3 gap-y-6 sm:grid-cols-6 xl:grid-cols-3">
      {GROUPS_LOW.map((g) => (
        <div key={g.category}>
          <div className="flex items-baseline justify-between gap-2 border-b border-line-strong pb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
            <span className="truncate text-ink-2">{CATEGORY_LABEL[g.category]}</span>
            <span className="num">{pad(g.records)}</span>
          </div>
          <div className="mt-2 space-y-2">
            {g.indices.map((i) => {
              const spec = TILES_LOW[i];
              return (
                <div key={spec.key} className="overflow-hidden rounded-[3px] bg-raised" style={{ aspectRatio: String(spec.aspect) }}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
                  <img src={spec.src} alt={spec.asset.title} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/* 04 · the parsed question and its results ------------------------------------ */

function SearchStill() {
  return (
    <div>
      <QueryPanel />
      <ul className="mt-5 space-y-2">
        {QUERY_RESULT.hits.map(({ asset }) => (
          <li key={asset.id} className="flex items-center gap-3 rounded-[8px] border border-line bg-surface p-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
            <img src={thumbUrl(asset, 160, 100)} alt="" loading="lazy" decoding="async" className="h-[50px] w-[80px] rounded-[4px] object-cover" />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {asset.finding && <SeverityBadge severity={asset.finding.severity} />}
                <span className="truncate font-mono text-[11px] text-ink-3">{asset.fileName}</span>
              </div>
              <p className="mt-1 truncate text-[13.5px] font-medium text-ink">{asset.finding?.title}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* 05 · the top-ranked finding ---------------------------------------------- */

function InsightStill() {
  return (
    <div className="grid grid-cols-1 items-start gap-8 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <div className="relative w-full overflow-hidden rounded-[8px] border border-line bg-raised" style={{ aspectRatio: `${HERO.width} / ${HERO.height}` }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
        <img src={displayUrl(HERO, 1000)} alt={HERO.title} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        {HERO.finding?.region && <RegionLayer regions={[HERO.finding.region]} variant="annotation" />}
        <span className="reticle" />
      </div>
      <InsightPanel />
    </div>
  );
}
