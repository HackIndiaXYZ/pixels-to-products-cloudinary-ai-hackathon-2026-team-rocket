'use client';

import { motion, useMotionValue, useTransform, type MotionValue } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  CloudUpload,
  FileText,
  Images,
  LayoutDashboard,
  ScanSearch,
  Search,
  Settings2,
  Siren,
  Wand2,
} from 'lucide-react';
import { ViewTransition, memo, type ReactNode } from 'react';
import type { MediaAsset, Region, Severity } from '@/lib/types';
import { SEVERITIES, captureBasisOf, type FindingRecord } from '@/lib/analytics';
import { DEMO_CLOUD } from '@/lib/cloudinary/config';
import { displayUrl, posterOffset, thumbUrl } from '@/lib/cloudinary/media';
import { formatDuration, relativeTime } from '@/lib/format';
import { Logo } from '@/components/brand/Logo';
import { servedUrl } from '@/components/console/hooks';
import { Swatch, firstSentence, transformationOf } from '@/components/console/overview/shared';
import { CloudImage } from '@/components/media/CloudImage';
import { MediaFrame } from '@/components/media/MediaFrame';
import { easeOutCubic } from '@/components/motion/hooks';
import { CategoryTag, Kbd, SEVERITY_COLOR, SeverityDot, StatusBadge } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { useModKey } from '@/components/ui/useModKey';
import { MOCK, MOCK_NOW } from './mock-data';

/**
 * When each part of the miniature arrives, in units of the reveal's scroll
 * progress (0–1). The frame itself finishes entering at 0.5. Every entrance is
 * a transform (or opacity) driven by a motion value — no React render per frame.
 */
const MOCK_TIMELINE = {
  /** KPI numbers count up (scroll-driven, so they are never stuck at a placeholder). */
  count: { start: 0.2, span: 0.2 },
  /** The lead's severity rule draws left to right. */
  rule: { start: 0.04, span: 0.16 },
  /** The evidence frame is uncovered left to right. */
  evidence: { start: 0.06, span: 0.2 },
  /** The severity word rises out of its mask. */
  poster: { start: 0.1, span: 0.14 },
  /** "Next in queue" items slide in. */
  queue: { start: 0.18, span: 0.12, stagger: 0.03 },
  /** The open-findings severity bar draws. */
  bar: { start: 0.24, span: 0.12 },
} as const;

type Span = { start: number; span: number };

/*
 * Container breakpoints stand in for the console's viewport breakpoints. The
 * miniature's container is as wide as the viewport it imitates (less a classic
 * scrollbar), so `@min-[640px]`/`@min-[768px]` act as the console's `sm`/`md`,
 * `@min-[1000px]` as its `lg` and `@min-[1264px]` as its `xl`.
 */

const NAV = [
  { label: 'Overview', icon: LayoutDashboard },
  { label: 'Library', icon: Images },
  { label: 'Incidents', icon: Siren },
  { label: 'Studio', icon: Wand2 },
  { label: 'Reports', icon: FileText },
] as const;

/** Mirrors the console sidebar's dataset note (ConsoleShell). */
const DATASET_NOTE = (
  <>
    {MOCK.fieldCount} sample field captures hosted on Cloudinary’s <span className="font-mono text-ink-2">{DEMO_CLOUD}</span> cloud.
    Findings are sample annotations, and capture times are set relative to now.
  </>
);

/**
 * A static-DOM miniature of the console's Command Center (ConsoleShell +
 * OverviewView): same tokens, same classes, same layout, and the same numbers,
 * because both call overviewSummary() on the same sample dataset. There is no
 * console state, no probe and nothing interactive; readings the console measures
 * live from Cloudinary are labelled as such instead of being imitated.
 *
 * The layout responds to its own width (container queries), so it renders like
 * the console at whatever width it is laid out — full-bleed or scaled into a card.
 *
 * View transitions: the content column is paired with the console's <main>
 * ('product-frame'), the top bar and sidebar with the console's header and
 * sidebar, and the tab bar with its mobile tab bar — so "Launch console" morphs
 * each part into place instead of cross-fading two different screens. `morph`
 * (default true) turns the names off while the preview is off screen.
 *
 * `progress` drives the entrance of the lead and queue; without it everything
 * is shown in its final state.
 */
export function ConsoleMock({ progress, morph = true }: { progress?: MotionValue<number>; morph?: boolean }) {
  const settled = useMotionValue(1);
  const p = progress ?? settled;
  const name = (id: string) => (morph ? id : undefined);

  return (
    <div aria-hidden inert className="flex h-full w-full select-none flex-col bg-canvas text-left text-ink">
      <ViewTransition name={name('console-topbar')} share="morph" default="none">
        <MockTopBar />
      </ViewTransition>
      <div className="flex min-h-0 flex-1">
        <ViewTransition name={name('console-sidebar')} share="morph" default="none">
          <MockSidebar />
        </ViewTransition>
        <ViewTransition name={name('product-frame')} share="morph" default="none">
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="mx-auto w-full max-w-[1440px] space-y-5 px-4 py-5 @min-[640px]:px-6 @min-[1000px]:space-y-6 @min-[1000px]:px-8 @min-[1000px]:py-7">
              <MockHeader />
              {MOCK.lead ? <MockLead record={MOCK.lead} p={p} /> : <MockNothingOpen />}
              <MockKeyNumbers p={p} />
            </div>
          </div>
        </ViewTransition>
      </div>
      <ViewTransition name={name('console-tabbar')} share="morph" default="none">
        <MockTabBar />
      </ViewTransition>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Shell                                                                   */
/* ---------------------------------------------------------------------- */

const MockTopBar = memo(function MockTopBar() {
  const mod = useModKey();
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line bg-canvas px-3 @min-[640px]:gap-3 @min-[640px]:px-4">
      <span className="flex shrink-0 items-center rounded-md px-1.5 py-1">
        <Logo />
      </span>
      <span className="hidden shrink-0 text-line-strong @min-[640px]:inline">/</span>
      <span className="hidden shrink-0 text-[13px] font-medium text-ink-2 @min-[640px]:inline">Overview</span>
      <span className="mx-auto flex h-8 min-w-0 max-w-[420px] flex-1 items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-ink-3">
        <Search className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">
          <span className="@min-[640px]:hidden">Ask VisualOps…</span>
          <span className="hidden @min-[640px]:inline">Ask anything about your visual data…</span>
        </span>
        <span className="ml-auto hidden shrink-0 items-center gap-1 @min-[640px]:flex">
          <Kbd>{mod}</Kbd>
          <Kbd>K</Kbd>
        </span>
      </span>
      <span className="hidden shrink-0 items-center gap-2 whitespace-nowrap rounded-[8px] border border-line px-2.5 py-1.5 font-mono text-[11px] text-ink-2 @min-[768px]:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-signal" />
        <span>cloud: {DEMO_CLOUD}</span>
        <span className="hidden text-ink-3 @min-[1000px]:inline">· read-only</span>
      </span>
      <span className="btn btn-primary btn-sm shrink-0">
        <CloudUpload className="h-3.5 w-3.5" />
        <span className="hidden @min-[640px]:inline">Ingest</span>
      </span>
      <span className="btn btn-ghost btn-sm btn-icon shrink-0 @min-[768px]:hidden">
        <Settings2 className="h-4 w-4" />
      </span>
    </div>
  );
});

const MockSidebar = memo(function MockSidebar() {
  return (
    <div className="hidden w-[220px] shrink-0 flex-col border-r border-line px-2.5 py-3 @min-[1000px]:flex">
      <div className="space-y-0.5">
        {NAV.map(({ label, icon: Icon }, i) => {
          const active = i === 0;
          return (
            <div
              key={label}
              className={cn(
                'relative flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13px]',
                active ? 'text-ink' : 'text-ink-2',
              )}
            >
              {active && <span className="absolute inset-0 rounded-[8px] border border-line bg-raised" />}
              <Icon className={cn('relative h-4 w-4', active ? 'text-signal' : 'text-ink-3')} />
              <span className="relative font-medium">{label}</span>
              {label === 'Incidents' && MOCK.counts.open > 0 && (
                <span className="num relative ml-auto rounded-[5px] bg-overlay px-1.5 font-mono text-[10.5px] text-ink-2">
                  {MOCK.counts.open}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-auto space-y-3 border-t border-line px-1.5 pt-3">
        <div>
          <div className="label">Dataset</div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink-3">{DATASET_NOTE}</p>
        </div>
        <span className="flex items-center gap-1 text-[12px] text-ink-3">
          Product story <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
});

/** The console's phone navigation, shown while the miniature is laid out narrower than `lg`. */
const MockTabBar = memo(function MockTabBar() {
  return (
    <div className="grid shrink-0 grid-cols-5 border-t border-line bg-canvas @min-[1000px]:hidden">
      {NAV.map(({ label, icon: Icon }, i) => (
        <span
          key={label}
          className={cn('flex flex-col items-center gap-1 py-2 text-[10.5px]', i === 0 ? 'text-ink' : 'text-ink-3')}
        >
          <Icon className={cn('h-[18px] w-[18px]', i === 0 && 'text-signal')} />
          {label}
        </span>
      ))}
    </div>
  );
});

/* ---------------------------------------------------------------------- */
/* Command Center                                                          */
/* ---------------------------------------------------------------------- */

const MockHeader = memo(function MockHeader() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <p className="label">Command center · sample dataset</p>
        <div className="type-heading mt-2.5 text-balance text-[26px] text-ink @min-[640px]:text-[30px]">{MOCK.headline}</div>
        <p className="mt-1.5 text-[13px] text-ink-3">{MOCK.summary}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="btn btn-secondary btn-sm">
          <Search className="h-3.5 w-3.5" /> Ask VisualOps
        </span>
        <span className="btn btn-secondary btn-sm">
          <FileText className="h-3.5 w-3.5" /> Build report
        </span>
      </div>
    </div>
  );
});

/** Scroll-driven 0→1 over a timeline span (1 when the preview is settled). */
function useSpan(p: MotionValue<number>, { start, span }: Span) {
  return useTransform(p, [start, start + span], [0, 1], { ease: easeOutCubic });
}

/** Age as the console shows it. Sample times are relative to now, so the age matches; fixed times show the camera's clock. */
function ageOf(asset: MediaAsset): string {
  return captureBasisOf(asset) === 'sample-relative'
    ? relativeTime(asset.capturedAt, MOCK_NOW)
    : (asset.cameraTime ?? asset.capturedAt.slice(0, 10));
}

/** The note beside a lead's age, worded as the console words it. */
function timeNote(asset: MediaAsset): string {
  return captureBasisOf(asset) === 'sample-relative'
    ? 'sample time, relative to now'
    : asset.cameraTime
      ? `camera time ${asset.cameraTime}`
      : 'time burned into the footage';
}

/** Mirrors LeadIncident: the worst open finding, evidence first. */
const MockLead = memo(function MockLead({ record, p }: { record: FindingRecord; p: MotionValue<number> }) {
  const { finding, asset } = record;
  const color = SEVERITY_COLOR[finding.severity];
  const isVideo = asset.resourceType === 'video';
  // Exactly the console's candidates and sizes, so the browser picks the same
  // rendition here and the console finds it in cache when the preview morphs in.
  const servedWidth = Math.min(1600, asset.width);
  const srcSet = [
    ...[800, 1200].filter((w) => w < servedWidth).map((w) => `${displayUrl(asset, w)} ${w}w`),
    `${displayUrl(asset, 1600)} ${servedWidth}w`,
  ].join(', ');
  const transformation = transformationOf(servedUrl(asset));

  const rule = useSpan(p, MOCK_TIMELINE.rule);
  const uncover = useTransform(useSpan(p, MOCK_TIMELINE.evidence), (t) => `${t * 101}%`);
  const posterY = useTransform(useSpan(p, MOCK_TIMELINE.poster), (t) => `${(1 - t) * 104}%`);

  return (
    <div className="panel overflow-hidden">
      <motion.span className="block h-[2px] w-full" style={{ backgroundColor: color, originX: 0, scaleX: rule }} />
      <div className="grid @min-[1264px]:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {/* Evidence */}
        <div className="flex min-w-0 flex-col border-b border-line @min-[1264px]:border-b-0 @min-[1264px]:border-r">
          <div className="survey-grid relative flex min-h-[240px] flex-1 items-center justify-center bg-canvas px-4 pb-11 pt-11 @min-[640px]:px-8">
            <span className="absolute left-4 top-3.5 flex items-center gap-2 font-mono text-[10.5px] text-ink-2 @min-[640px]:left-5">
              <span className="max-w-[180px] truncate">{asset.fileName}</span>
              <span className="num text-ink-3">
                {asset.width}×{asset.height}
              </span>
            </span>
            <span className="label absolute right-4 top-3.5 @min-[640px]:right-5">
              {isVideo ? `Video · still at ${formatDuration(posterOffset(asset))}` : 'Photo'}
            </span>
            <MediaFrame
              width={asset.width}
              height={asset.height}
              maxHeight="min(420px, 64cqw)"
              className="rounded-[4px] bg-raised ring-1 ring-line"
            >
              <CloudImage
                src={displayUrl(asset, 1600)}
                srcSet={srcSet}
                sizes="(min-width: 1280px) 46vw, 92vw"
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              {finding.region && <MockRegion region={finding.region} />}
              <span className="reticle" />
              {/* Uncovers the frame left to right, as the console's clip-path wipe does — with a transform. */}
              <motion.span className="absolute inset-0 bg-canvas" style={{ x: uncover }} />
            </MediaFrame>
            {finding.region && (
              <span className="absolute bottom-3.5 left-4 flex items-center gap-2 font-mono text-[10.5px] text-ink-3 @min-[640px]:left-5">
                <span className="h-2 w-2 rounded-[2px] border-[1.5px] border-high" />
                Region · sample annotation
              </span>
            )}
          </div>
          <div className="flex min-h-[40px] flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 font-mono text-[11px] text-ink-3 @min-[640px]:px-5">
            <span className="text-ink-2">{isVideo ? 'Playback rendition' : 'Served rendition'}</span>
            <span>bytes and timing measured live in the console</span>
            {transformation && (
              <span className="ml-auto hidden max-w-[45%] truncate @min-[1000px]:inline">{transformation}</span>
            )}
          </div>
        </div>

        {/* Decision */}
        <div className="flex min-w-0 flex-col p-5 @min-[640px]:p-7">
          <div className="flex items-center justify-between gap-3">
            <span className="label flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
              Lead incident · worst open finding
            </span>
            <span className="font-mono text-[11px] text-ink-3">{finding.id}</span>
          </div>

          <div className="mt-5 overflow-hidden pb-[0.04em]">
            <motion.p className="type-poster text-[60px] @min-[640px]:text-[78px]" style={{ color, y: posterY }}>
              {finding.severity}
            </motion.p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <CategoryTag category={finding.category} />
            <StatusBadge status={finding.status} />
          </div>

          <div className="type-heading mt-4 text-balance text-[22px] text-ink @min-[640px]:text-[26px]">{finding.title}</div>
          <p className="mt-2.5 max-w-[58ch] text-[14px] leading-relaxed text-ink-2">{firstSentence(finding.summary)}</p>
          <p className="mt-1.5 font-mono text-[10.5px] text-ink-3">Sample annotation</p>

          <dl className="mt-5 grid grid-cols-[92px_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-t border-line pt-4 text-[13px]">
            <dt className="label pt-[3px]">Site</dt>
            <dd className="min-w-0 text-ink">
              {asset.site}
              {asset.zone && <span className="text-ink-3"> · {asset.zone}</span>}
            </dd>
            <dt className="label pt-[3px]">Age</dt>
            <dd className="min-w-0 text-ink">
              {ageOf(asset)}
              <span className="font-mono text-[11.5px] text-ink-3"> · {timeNote(asset)}</span>
            </dd>
            <dt className="label pt-[3px]">Source</dt>
            <dd className="min-w-0 truncate text-ink-2">{asset.capturedBy}</dd>
            <dt className="label pt-[3px]">Action</dt>
            <dd className="min-w-0 text-ink">{firstSentence(finding.action)}</dd>
          </dl>

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
            <span className="btn btn-primary">
              <ScanSearch className="h-4 w-4" /> Inspect
            </span>
            <span className="btn btn-secondary">
              <Wand2 className="h-4 w-4" /> Open in Studio
            </span>
          </div>
        </div>
      </div>

      {/* Triage queue */}
      {MOCK.queue.length > 0 && (
        <div className="border-t border-line">
          <div className="flex items-center justify-between gap-3 px-5 py-2.5 @min-[640px]:px-6">
            <span className="label">Next in queue</span>
            <span className="flex items-center gap-1 text-[12px] text-ink-3">
              All {MOCK.open.length} open <ArrowRight className="h-3 w-3" />
            </span>
          </div>
          <ul className="grid divide-y divide-line border-t border-line @min-[768px]:grid-cols-3 @min-[768px]:divide-x @min-[768px]:divide-y-0">
            {MOCK.queue.map((r, i) => (
              <QueueItem key={r.finding.id} record={r} p={p} index={i} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
});

function MockNothingOpen() {
  return (
    <div className="panel flex flex-col items-start gap-3 px-6 py-10 @min-[640px]:px-8">
      <span className="label">Lead incident</span>
      <p className="type-heading text-[24px] text-ink">No open findings.</p>
    </div>
  );
}

function MockRegion({ region }: { region: Region }) {
  return (
    <span
      className="absolute rounded-[3px] border-[1.5px] border-high bg-[color-mix(in_oklab,var(--color-high)_10%,transparent)]"
      style={{ left: `${region.x}%`, top: `${region.y}%`, width: `${region.w}%`, height: `${region.h}%` }}
    >
      {region.label && (
        <span
          className={cn(
            'absolute -top-[18px] left-[-1.5px] whitespace-nowrap rounded-[3px] bg-high px-1.5 py-[1px] font-mono text-[10.5px] font-semibold leading-[14px] tracking-[0.06em] text-signal-ink',
            region.y < 6 && 'left-[2px] top-[2px]',
          )}
        >
          {region.label}
        </span>
      )}
    </span>
  );
}

function QueueItem({ record, p, index }: { record: FindingRecord; p: MotionValue<number>; index: number }) {
  const { start, span, stagger } = MOCK_TIMELINE.queue;
  const t = useSpan(p, { start: start + index * stagger, span });
  const x = useTransform(t, [0, 1], [24, 0]);
  const opacity = useTransform(t, [0, 0.7], [0, 1]);
  const { finding, asset } = record;
  return (
    <motion.li className="min-w-0" style={{ x, opacity }}>
      <span className="flex w-full items-center gap-3 px-5 py-3 @min-[640px]:px-6">
        <span className="relative h-11 w-16 shrink-0 overflow-hidden rounded-[4px] border border-line bg-raised">
          <CloudImage
            src={thumbUrl(asset, 128, 88)}
            srcSet={`${thumbUrl(asset, 64, 44)} 1x, ${thumbUrl(asset, 128, 88)} 2x`}
            alt=""
            className="h-full w-full object-cover"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <SeverityDot severity={finding.severity} />
            <span className="label text-ink-2">{finding.severity}</span>
            <span className="font-mono text-[10.5px] text-ink-3">{finding.id}</span>
          </span>
          <span className="mt-0.5 block truncate text-[13px] font-medium text-ink">{finding.title}</span>
          <span className="block truncate text-[11.5px] text-ink-3">
            {asset.site} · {ageOf(asset)}
          </span>
        </span>
      </span>
    </motion.li>
  );
}

/* ---------------------------------------------------------------------- */
/* Key numbers                                                             */
/* ---------------------------------------------------------------------- */

/** Mirrors KeyNumbers. Dataset counts are shown; readings the console measures live are labelled, never imitated. */
const MockKeyNumbers = memo(function MockKeyNumbers({ p }: { p: MotionValue<number> }) {
  const { counts, openBySeverity, riskiest } = MOCK;
  return (
    <div className="panel overflow-hidden">
      <div className="grid grid-cols-2 gap-px bg-line @min-[1264px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.35fr)]">
        <Cell
          label="Open findings"
          className="col-span-2 @min-[1264px]:col-span-1"
          value={<Count value={counts.open} p={p} />}
          foot={`${counts.monitoring} monitoring · ${counts.resolved} resolved`}
        >
          <MockSeverityBar counts={openBySeverity} total={counts.open} p={p} />
          <span className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10.5px] text-ink-2 @min-[640px]:grid-cols-4 @min-[1264px]:grid-cols-2">
            {SEVERITIES.map((s) => (
              <span key={s} className="flex min-w-0 items-center gap-1.5">
                <Swatch color={SEVERITY_COLOR[s]} />
                <span className="num">{openBySeverity[s]}</span>
                <span className="truncate text-ink-3">{s}</span>
              </span>
            ))}
          </span>
        </Cell>

        <Cell
          label="Media processed"
          value={<Count value={MOCK.fieldCount} p={p} />}
          foot="Hosted and served by Cloudinary"
        >
          <span className="text-[12.5px] text-ink-2">
            <span className="num">{MOCK.photos}</span> photos · <span className="num">{MOCK.videos}</span> videos
          </span>
        </Cell>

        <Cell
          label="Sites reporting"
          value={<Count value={MOCK.siteCount} p={p} />}
          foot="Ranked by worst unresolved finding"
        >
          {riskiest?.worst ? (
            <span className="block min-w-0 text-[12.5px]">
              <span className="flex min-w-0 items-center gap-1.5 text-ink-3">
                <Swatch color={SEVERITY_COLOR[riskiest.worst]} />
                <span className="truncate">Highest risk · {riskiest.worst}</span>
              </span>
              <span className="mt-0.5 block truncate text-ink">{riskiest.site}</span>
            </span>
          ) : (
            <span className="text-[12.5px] text-ink-3">No unresolved risk</span>
          )}
        </Cell>

        <Cell label="AI signals · live" value={<Live />} foot="Requested when the console opens">
          <span className="text-[12.5px] text-ink-2">fl_getinfo on every capture</span>
        </Cell>

        <Cell label="Delivery optimisation" value={<Live />} foot="HEAD-probed when the console opens">
          <span className="text-[12.5px] text-ink-2">Original vs delivered bytes, per rendition</span>
        </Cell>
      </div>
    </div>
  );
});

function Cell({
  label,
  value,
  children,
  foot,
  className,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
  foot?: string;
  className?: string;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col bg-surface p-4 @min-[640px]:p-5', className)}>
      <span className="label">{label}</span>
      <span className="num mt-3 block text-[34px] font-semibold leading-none tracking-[-0.035em] text-ink">{value}</span>
      <span className="mt-3 block min-w-0">{children}</span>
      {foot && <span className="mt-auto block pt-3 text-[11.5px] text-ink-3">{foot}</span>}
    </div>
  );
}

/**
 * Counts up with the reveal's progress, writing text through a motion value (no
 * React render per frame). Before it starts it shows a neutral dash — never a
 * misleading 0; settled previews (and the server HTML) show the final figure.
 */
function Count({ value, p }: { value: number; p: MotionValue<number> }) {
  const t = useSpan(p, MOCK_TIMELINE.count);
  const text = useTransform(t, (v) => (v <= 0 ? '—' : String(Math.round(value * v))));
  const opacity = useTransform(t, (v) => (v <= 0 ? 0.4 : 1));
  return <motion.span style={{ opacity }}>{text}</motion.span>;
}

/** Stands in for a figure the console measures from Cloudinary at run time. */
function Live() {
  return (
    <span className="flex h-[34px] items-end gap-2 font-mono text-[13px] font-normal leading-none tracking-normal text-ink-2">
      <span className="h-1.5 w-1.5 -translate-y-[3px] rounded-full bg-signal" />
      measured live
    </span>
  );
}

function MockSeverityBar({ counts, total, p }: { counts: Record<Severity, number>; total: number; p: MotionValue<number> }) {
  const scaleX = useSpan(p, MOCK_TIMELINE.bar);
  if (!total) return <span className="block h-2 w-full rounded-[2px] bg-raised" />;
  return (
    <motion.span className="flex h-2 w-full gap-[2px]" style={{ originX: 0, scaleX }}>
      {SEVERITIES.map((s) =>
        counts[s] ? (
          <span
            key={s}
            className="h-full first:rounded-l-[2px] last:rounded-r-[2px]"
            style={{ flexGrow: counts[s], flexBasis: 0, backgroundColor: SEVERITY_COLOR[s] }}
          />
        ) : null,
      )}
    </motion.span>
  );
}
