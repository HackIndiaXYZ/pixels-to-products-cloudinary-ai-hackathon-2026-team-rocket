'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import type { MediaAsset } from '@/lib/types';
import { fieldAssets, SEVERITY_RANK, STATUS_LABEL } from '@/lib/analytics';
import { frameUrl, posterOffset } from '@/lib/cloudinary/media';
import { formatBytes, pluralize } from '@/lib/format';
import { RevealText } from '@/components/motion/RevealText';
import { SEVERITY_COLOR } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { LANDING_ASSETS, landingAsset } from './landing-data';
import { EditorialMedia } from './editorial/EditorialMedia';
import { DomainRule, DomainText } from './editorial/DomainText';
import { DOMAINS, domainAssets, domainFacts, type Domain } from './editorial/domains';
import { captureSizeSource, cropSource, megapixels, nativeSource, timecode } from './editorial/media-sources';
import { PlateStrip } from './editorial/PlateStrip';
import { EASE_EDITORIAL } from './editorial/hooks';

/* ------------------------------------------------------------------------ */
/* Data — all derived from the Cloudinary-hosted sample dataset               */
/* ------------------------------------------------------------------------ */

const FIELD = fieldAssets(LANDING_ASSETS);

const domain = (key: string): Domain => {
  const found = DOMAINS.find((d) => d.key === key);
  if (!found) throw new Error(`Unknown domain ${key}`);
  return found;
};

const A = {
  deck: landingAsset('vo-demolition-deck'),
  crew: landingAsset('vo-crew-ppe'),
  ole: landingAsset('vo-ole-survey'),
  road: landingAsset('vo-road-collapse'),
  bridge: landingAsset('vo-bridge-truss'),
  washroom: landingAsset('vo-washroom-panel'),
  cctv: landingAsset('vo-cctv-kitchen'),
  wet: landingAsset('vo-wet-floor'),
  checkin: landingAsset('vo-fleet-checkin'),
  dash: landingAsset('vo-fleet-dash'),
  yard: landingAsset('vo-equipment-yard'),
  label: landingAsset('vo-receiving-label'),
  crib: landingAsset('vo-tool-crib'),
  hotwork: landingAsset('vo-hot-work'),
  plant: landingAsset('vo-plant-walkthrough'),
};

/** Four evenly spaced frames across the yard sweep, each extracted by Cloudinary (so_). */
const YARD_FRAMES = [0, 1, 2, 3].map((i) => Math.round(((A.yard.duration ?? 60) * (i + 0.5) * 10) / 4) / 10);

const CONTAINER = 'mx-auto w-full max-w-[1440px] px-5 sm:px-8';
const GRID = 'grid lg:grid-cols-12 lg:gap-x-8';
/** Space between a domain's running rule and its spread. */
const SPREAD = 'mt-5 gap-y-7 sm:mt-8 sm:gap-y-8 lg:mt-10 lg:gap-y-10';
/** Space between a spread and its row of secondary plates. */
const ROW = 'mt-8 sm:mt-10';
/** Phone/tablet horizontal scroll-snap row that bleeds to the screen edges (desktop layouts override it). */
const SNAP_ROW = '-mx-5 flex snap-x snap-mandatory scroll-px-5 items-start gap-3 overflow-x-auto overscroll-x-contain px-5 [scrollbar-width:thin] sm:-mx-8 sm:scroll-px-8 sm:gap-4 sm:px-8';

/* ------------------------------------------------------------------------ */
/* Section                                                                    */
/* ------------------------------------------------------------------------ */

/**
 * Solutions — five operating domains, each told with its own real captures in
 * an editorial spread: a lead plate beside the domain text, then the rest of
 * the domain's captures as one row of plates at a shared height (a justified
 * row on desktop, a scroll-snap row on phones). Every field capture appears.
 */
export function Solutions() {
  return (
    <section id="solutions" aria-label="Solutions" className="theme-light relative overflow-hidden">
      <div className={cn(CONTAINER, 'pt-16 sm:pt-28')}>
        <SolutionsHeader />
        <DomainIndex />
      </div>

      <div className="mt-12 space-y-14 sm:mt-16 sm:space-y-24 lg:mt-20">
        <Construction />
        <Infrastructure />
        <Facilities />
        <Fleet />
        <Stores />
      </div>

      <div className={cn(CONTAINER, 'pb-14 pt-14 sm:pb-24 sm:pt-20')}>
        <div className={cn(GRID, 'gap-y-6 border-t border-line pt-6')}>
          <p className="max-w-[62ch] text-[13.5px] leading-[1.65] text-ink-2 lg:col-span-7">
            Every frame in this section is a real capture served from Cloudinary’s public demo cloud — cropped with{' '}
            <code className="font-mono text-[12.5px] text-ink">g_auto</code> or shown whole, sized to its slot and delivered with{' '}
            <code className="font-mono text-[12.5px] text-ink">q_auto</code> and{' '}
            <code className="font-mono text-[12.5px] text-ink">f_auto</code>. Finding IDs and severities are sample annotations
            written by the VisualOps team.
          </p>
          <div className="flex items-start lg:col-span-4 lg:col-start-9 lg:justify-end">
            <Link href="/console#library" className="btn btn-secondary btn-lg" data-cursor="OPEN">
              Browse all {FIELD.length} captures <ArrowUpRight aria-hidden className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

function SolutionsHeader() {
  return (
    <header className={cn(GRID, 'gap-y-7 sm:gap-y-10')}>
      <div className="flex items-baseline justify-between gap-6 border-t border-ink pt-4 lg:col-span-12">
        <p className="label text-ink">Solutions</p>
        <p className="label num text-right">{DOMAINS.length} operating domains</p>
      </div>
      <RevealText
        as="h2"
        lines={['Built for the teams', 'who photograph', 'the physical world.']}
        className="type-display text-[41px] text-ink min-[400px]:text-[45px] sm:text-[64px] md:text-[80px] lg:col-span-8 lg:text-[78px] xl:text-[98px] min-[1440px]:text-[112px]"
      />
      <motion.p
        className="max-w-[40ch] text-pretty text-[16px] leading-[1.6] text-ink-2 sm:text-[17px] lg:col-span-4 lg:self-end lg:pb-2"
        initial={{ opacity: 0, y: 14 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: '0px 0px -10% 0px' }}
        transition={{ duration: 0.7, delay: 0.25, ease: EASE_EDITORIAL }}
      >
        Inspectors, site managers, and facilities, fleet and stores teams already record the physical world on phones, drones and
        fixed cameras. VisualOps gives every capture a site, a finding, a severity and a next action — and makes all of it
        searchable.
      </motion.p>
    </header>
  );
}

/**
 * Table of contents. Each domain shows one mark per finding, coloured by
 * severity and ordered worst first, with the same facts in words beside them.
 */
function DomainIndex() {
  return (
    <nav
      aria-label="Solutions by domain"
      className={cn(SNAP_ROW, 'mt-10 gap-x-5 sm:mx-0 sm:mt-14 sm:grid sm:grid-cols-3 sm:gap-y-7 sm:overflow-visible sm:px-0 lg:mt-14 lg:grid-cols-5 lg:gap-x-8')}
    >
      {DOMAINS.map((d, i) => {
        const facts = domainFacts(d);
        return (
          <a
            key={d.key}
            href={`#${d.anchor}`}
            className="group relative block w-[60vw] shrink-0 snap-start pt-3.5 focus-visible:outline-offset-4 sm:w-auto"
          >
            <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-line-strong" />
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-px origin-left scale-x-0 bg-ink transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-x-100 group-focus-visible:scale-x-100"
            />
            <span className="label num">{String(i + 1).padStart(2, '0')}</span>
            <span className="mt-2 block text-[15px] font-medium leading-snug tracking-[-0.01em] text-ink">{d.title}</span>
            <span aria-hidden className="mt-2.5 flex flex-wrap items-center gap-x-1 gap-y-1.5">
              {facts.findings.map((f) => (
                <span
                  key={f.id}
                  title={`${f.id} · ${f.severity}`}
                  className="h-1.5 w-3 rounded-[1px]"
                  style={{ backgroundColor: SEVERITY_COLOR[f.severity] }}
                />
              ))}
              <span className="num ml-1.5 whitespace-nowrap font-mono text-[10.5px] leading-none text-ink-3">
                {pluralize(facts.findings.length, 'finding')}
                {facts.worst ? ` · worst ${facts.worst}` : ''}
              </span>
            </span>
            <span className="sr-only">
              , {pluralize(facts.count, 'capture')}: {facts.findings.map((f) => `${f.id} ${f.severity}`).join(', ')}
            </span>
          </a>
        );
      })}
    </nav>
  );
}

/** Domain wrapper: anchor target, labelled by its title, opened by the running rule. */
function DomainArticle({ d, children, className }: { d: Domain; children: ReactNode; className?: string }) {
  return (
    <article id={d.anchor} aria-labelledby={`${d.anchor}-title`} className={cn('scroll-mt-24', className)}>
      <div className={CONTAINER}>
        <DomainRule domain={d} />
      </div>
      {children}
    </article>
  );
}

/* ------------------------------------------------------------------------ */
/* 01 · Construction — lead plate with a side column and an offset crop       */
/* ------------------------------------------------------------------------ */

function Construction() {
  const d = domain('construction');
  return (
    <DomainArticle d={d}>
      <div className={cn(CONTAINER, GRID, SPREAD)}>
        <EditorialMedia
          asset={A.deck}
          source={cropSource(A.deck, [16, 10], [640, 960, 1280, 1600], '(min-width: 1024px) 64vw, 100vw')}
          note={`Still extracted from the drone video by Cloudinary · so_${posterOffset(A.deck)} · c_fill,g_auto`}
          className="order-2 lg:order-none lg:col-span-8"
        />
        {/* Below lg the column dissolves so the title leads, then the plate, then the crop. */}
        <div className="contents lg:col-span-4 lg:flex lg:flex-col">
          <DomainText domain={d} titleId={`${d.anchor}-title`} className="order-1 lg:order-none" />
          <EditorialMedia
            asset={A.crew}
            source={cropSource(A.crew, [4, 3], [400, 560, 680], '(min-width: 1024px) 22vw, 60vw', { redactFaces: true })}
            note="Faces pixelated by Cloudinary · e_pixelate_faces"
            className="order-3 w-[56%] justify-self-end sm:w-[40%] lg:order-none lg:mt-auto lg:w-[64%] lg:self-end lg:pt-8"
          />
        </div>
      </div>
    </DomainArticle>
  );
}

/* ------------------------------------------------------------------------ */
/* 02 · Infrastructure — critical plate, register, panorama row                */
/* ------------------------------------------------------------------------ */

function Register({ className }: { className?: string }) {
  const register = domainAssets(domain('infrastructure'))
    .filter((a) => a.finding)
    .sort((a, b) => SEVERITY_RANK[b.finding!.severity] - SEVERITY_RANK[a.finding!.severity]);
  const first = register[0];
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      transition={{ duration: 0.7, ease: EASE_EDITORIAL }}
    >
      <div className="flex items-baseline justify-between gap-4 border-t border-ink pt-3">
        <p className="label text-ink">Register</p>
        <p className="label normal-case tracking-[0.02em]">Sample annotations</p>
      </div>
      <ol className="mt-1">
        {register.map((a) =>
          a.finding ? (
            <li key={a.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-b border-line py-2.5 sm:py-3">
              <span aria-hidden className="mt-[5px] h-2 w-2 rounded-[2px]" style={{ backgroundColor: SEVERITY_COLOR[a.finding.severity] }} />
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                  <span className="text-ink">{a.finding.id}</span>
                  <span>
                    {a.finding.severity} · {STATUS_LABEL[a.finding.status]}
                  </span>
                </div>
                <p className="mt-1 text-[14px] leading-snug text-ink">{a.finding.title}</p>
              </div>
            </li>
          ) : null,
        )}
      </ol>
      {first?.finding && (
        <p className="mt-3 hidden text-[13px] leading-relaxed text-ink-3 sm:block">
          One record per capture, ordered by severity, so the {first.finding.severity} finding on {first.site} is read first.
        </p>
      )}
    </motion.div>
  );
}

function Infrastructure() {
  const d = domain('infrastructure');
  return (
    <DomainArticle d={d}>
      <div className={cn(CONTAINER, GRID, SPREAD)}>
        <DomainText domain={d} titleId={`${d.anchor}-title`} className="lg:col-span-4" />
        <EditorialMedia
          asset={A.road}
          source={cropSource(A.road, [3, 2], [480, 624], '(min-width: 1024px) 38vw, 100vw')}
          className="sm:max-w-[624px] lg:col-span-5 lg:max-w-none"
        />
        <Register className="lg:col-span-3" />
      </div>
      <div className={cn(CONTAINER, ROW)}>
        <PlateStrip
          label={`${d.title}: survey captures`}
          items={[
            {
              asset: A.ole,
              source: nativeSource(A.ole, [750, 1000, 1500], '(min-width: 1024px) 56vw, 84vw'),
              note: `${A.ole.width} × ${A.ole.height} px panorama · c_limit · q_auto · f_auto`,
            },
            { asset: A.bridge, source: nativeSource(A.bridge, [640, 960, 1280], '(min-width: 1024px) 40vw, 84vw') },
          ]}
        />
      </div>
    </DomainArticle>
  );
}

/* ------------------------------------------------------------------------ */
/* 03 · Facilities & plant — lead clip, then the round as one row of plates    */
/* ------------------------------------------------------------------------ */

function Facilities() {
  const d = domain('facilities');
  return (
    <DomainArticle d={d}>
      <div className={cn(CONTAINER, GRID, SPREAD)}>
        <EditorialMedia
          asset={A.hotwork}
          source={cropSource(A.hotwork, [16, 9], [640, 960, 1280], '(min-width: 1024px) 56vw, 100vw')}
          clip={[800, 450]}
          note={`Still at so_${posterOffset(A.hotwork)} · on desktop, hover plays a 4 s clip trimmed by Cloudinary (du_4)`}
          className="order-2 lg:order-none lg:col-span-6"
        />
        <DomainText domain={d} titleId={`${d.anchor}-title`} className="order-1 lg:order-none lg:col-span-5 lg:col-start-8" />
      </div>
      <div className={cn(CONTAINER, ROW)}>
        <PlateStrip
          label={`${d.title}: more captures`}
          items={[
            { asset: A.washroom, source: nativeSource(A.washroom, [320, 480, 720], '(min-width: 1024px) 15vw, 40vw') },
            {
              asset: A.cctv,
              source: cropSource(A.cctv, [16, 9], [480, 720, 960], '(min-width: 1024px) 34vw, 84vw'),
              clip: [640, 360],
              hud: 'bottom',
              note: `Still at so_${posterOffset(A.cctv)} · the camera’s burned-in timestamp stays in frame`,
            },
            {
              asset: A.wet,
              source: captureSizeSource(A.wet),
              note: `Capture size ${A.wet.width} × ${A.wet.height} px · ${formatBytes(A.wet.bytes)}`,
            },
            {
              asset: A.plant,
              source: cropSource(A.plant, [4, 5], [320, 480], '(min-width: 1024px) 16vw, 40vw'),
              clip: [480, 600],
            },
          ]}
        />
      </div>
    </DomainArticle>
  );
}

/* ------------------------------------------------------------------------ */
/* 04 · Fleet & equipment — text column, paired plates, contact sheet          */
/* ------------------------------------------------------------------------ */

function Fleet() {
  const d = domain('fleet');
  return (
    <DomainArticle d={d}>
      <div className={cn(CONTAINER, GRID, SPREAD)}>
        <DomainText domain={d} titleId={`${d.anchor}-title`} className="lg:col-span-4" />
        <PlateStrip
          className="lg:col-span-8"
          label={`${d.title}: captures`}
          items={[
            {
              asset: A.checkin,
              source: nativeSource(A.checkin, [640, 960, 1280], '(min-width: 1024px) 34vw, 84vw'),
              note: `As captured · ${A.checkin.width} × ${A.checkin.height} px · plate and people in frame`,
            },
            { asset: A.dash, source: nativeSource(A.dash, [480, 720, 900], '(min-width: 1024px) 30vw, 84vw') },
          ]}
        />
      </div>

      <div className={cn(CONTAINER, 'mt-10 sm:mt-12')}>
        <ContactSheet />
      </div>
    </DomainArticle>
  );
}

function ContactSheet() {
  const yard = A.yard;
  return (
    <motion.div
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: 0.08 } } }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-ink pt-3">
        <p className="label text-ink">
          Contact sheet · {yard.fileName} · {yard.finding?.id}
        </p>
        <p className="label">
          {yard.duration ? `${yard.duration} s · ` : ''}4 frames extracted by Cloudinary
        </p>
      </div>
      <ol className={cn(SNAP_ROW, 'mt-4 md:mx-0 md:grid md:grid-cols-4 md:gap-4 md:overflow-visible md:px-0')}>
        {YARD_FRAMES.map((t) => (
          <motion.li
            key={t}
            className="w-[64vw] shrink-0 snap-start sm:w-[42vw] md:w-auto"
            variants={{ hidden: { opacity: 0, y: 14 }, shown: { opacity: 1, y: 0 } }}
            transition={{ duration: 0.6, ease: EASE_EDITORIAL }}
          >
            <Link
              href={`/console#library/${yard.id}`}
              prefetch={false}
              data-cursor="VIEW"
              aria-label={`${yard.title}, frame at ${timecode(t)}. Open in the media library`}
              className="group block"
            >
              <span className="relative block aspect-video overflow-hidden rounded-[3px] bg-raised">
                {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
                <img
                  src={frameUrl(yard, t, 480, 270)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-cover transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.05] group-focus-visible:scale-[1.05] motion-reduce:transition-none"
                />
              </span>
              <span className="mt-2 flex items-baseline justify-between font-mono text-[10.5px] text-ink-3 transition-colors duration-300 group-hover:text-ink">
                <span className="num">{timecode(t)}</span>
                <span>so_{t}</span>
              </span>
            </Link>
          </motion.li>
        ))}
      </ol>
      <p className="mt-4 max-w-[60ch] text-[13px] leading-relaxed text-ink-3">
        {yard.site} · {yard.zone}. A {Math.round(yard.duration ?? 0)}-second sweep becomes four stills a reviewer can scan in one
        glance — each one a Cloudinary URL, not a file someone had to export.
      </p>
    </motion.div>
  );
}

/* ------------------------------------------------------------------------ */
/* 05 · Stores & inventory — scale contrast on one baseline                    */
/* ------------------------------------------------------------------------ */

function ScaleFigure({ asset, className }: { asset: MediaAsset; className?: string }) {
  return (
    <div className={cn('mt-5', className)}>
      <p className="type-poster num text-[48px] text-ink sm:text-[72px] xl:text-[96px] min-[1440px]:text-[104px]">
        {megapixels(asset)}
        <span className="ml-2 text-[0.36em] text-ink-3">MP</span>
      </p>
      <p className="mt-2 font-mono text-[11px] text-ink-3">
        {asset.width} × {asset.height} px · {formatBytes(asset.bytes)} original · {asset.format.toUpperCase()}
      </p>
    </div>
  );
}

function Stores() {
  const d = domain('stores');
  return (
    <DomainArticle d={d}>
      <div className={cn(CONTAINER, GRID, SPREAD)}>
        <DomainText domain={d} titleId={`${d.anchor}-title`} className="lg:col-span-4" />
        {/* Phones: one scroll-snap row. Desktop: the two plates join the grid, their figures on one baseline. */}
        <div className={cn(SNAP_ROW, 'lg:contents')}>
          <div className="w-[80vw] shrink-0 snap-start sm:w-[54vw] lg:col-span-5 lg:w-auto lg:self-end">
            <EditorialMedia
              asset={A.label}
              source={nativeSource(A.label, [640, 960, 1280, 1600], '(min-width: 1024px) 38vw, 80vw')}
              note={`Downscaled by Cloudinary from the ${A.label.width} px original · c_limit · q_auto · f_auto`}
            />
            <ScaleFigure asset={A.label} />
          </div>
          <div className="w-[80vw] shrink-0 snap-start sm:w-[40vw] lg:col-span-3 lg:w-auto lg:self-end">
            <EditorialMedia
              asset={A.crib}
              source={captureSizeSource(A.crib)}
              captureSize
              note={`Capture size ${A.crib.width} × ${A.crib.height} px — too small to read a serial plate`}
            />
            <ScaleFigure asset={A.crib} />
          </div>
        </div>
      </div>
    </DomainArticle>
  );
}
