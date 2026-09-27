'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Film } from 'lucide-react';
import type { FindingStatus, MediaAsset, Severity } from '@/lib/types';
import { CATEGORY_LABEL, STATUS_LABEL, type FindingRecord } from '@/lib/analytics';
import { thumbUrl } from '@/lib/cloudinary/media';
import { pluralize } from '@/lib/format';
import { CloudImage } from '@/components/media/CloudImage';
import { SEVERITY_COLOR, StatusBadge } from '@/components/ui/badges';
import { ProvenanceBadge } from '@/components/ui/Provenance';
import { cn } from '@/components/ui/cn';
import { EASE, aiAnalysed, captureWhen, firstSentence, groupBySeverity, humanProvenanceDetails, type CaptureWhen } from './model';

/**
 * Density follows consequence: critical/high rows carry a large frame and the
 * observation, medium rows a title line, low rows a single quiet line. The
 * findings are human classified; the order is system derived; a row whose media
 * Cloudinary's AI has described carries its caption (major rows) or an "ai" mark.
 */
type Tier = 'major' | 'standard' | 'minor';
const TIER: Record<Severity, Tier> = { critical: 'major', high: 'major', medium: 'standard', low: 'minor' };

const STAGGER = 0.035;
const STAGGER_CAP = 14;

export function FindingList({
  records,
  now,
  hasLead,
  animateLayout,
  onInspect,
}: {
  records: FindingRecord[];
  now: number;
  hasLead: boolean;
  /** framer layout animations — only for short lists on capable devices. */
  animateLayout: boolean;
  onInspect: (assetId: string) => void;
}) {
  const groups = groupBySeverity(records);
  const order = new Map(records.map((r, i) => [r.finding.id, i]));
  const layout = animateLayout ? ('position' as const) : false;
  const empty = records.length === 0;

  return (
    <section aria-labelledby="incident-list-title" className="panel overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-3">
        <h2 id="incident-list-title" className="text-[13.5px] font-semibold">
          {hasLead ? 'Also in view' : 'In view'}
        </h2>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="label">{pluralize(records.length, 'finding')}</span>
          {!empty && (
            <>
              <ProvenanceBadge kind="system" detail="worst first" />
              <ProvenanceBadge kind="human" detail={humanProvenanceDetails(records.map((r) => r.asset)).join(' · ')} />
            </>
          )}
        </span>
      </header>

      {empty ? (
        // With no lead, the lead panel above already explains the empty view; the header's count is enough here.
        hasLead && (
          <p className="border-t border-line px-4 py-8 text-center text-[13px] text-ink-3">
            Nothing else matches — the lead is the only finding in this view.
          </p>
        )
      ) : (
        <div className="relative">
          <AnimatePresence initial mode="popLayout">
            {groups.map((group) => (
              <motion.section
                key={group.severity}
                aria-label={`${group.severity} severity`}
                layout={layout}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, transition: { duration: 0.14 } }}
                transition={{ duration: 0.3, ease: EASE, layout: { duration: 0.4, ease: EASE } }}
              >
                <GroupHeader severity={group.severity} count={group.records.length} />
                <ul className="relative">
                  <AnimatePresence initial mode="popLayout">
                    {group.records.map((record) => (
                      <motion.li
                        key={record.finding.id}
                        layout={layout}
                        className="border-t border-line"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, transition: { duration: 0.14 } }}
                        transition={{
                          duration: 0.45,
                          ease: EASE,
                          delay: 0.12 + Math.min(order.get(record.finding.id) ?? 0, STAGGER_CAP) * STAGGER,
                          layout: { duration: 0.4, ease: EASE, delay: 0 },
                        }}
                      >
                        <FindingRow record={record} now={now} onInspect={onInspect} />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              </motion.section>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function GroupHeader({ severity, count }: { severity: Severity; count: number }) {
  return (
    <div className="flex items-center gap-3 border-t border-line bg-canvas/50 px-4 py-2">
      <span aria-hidden className="h-3.5 w-[3px] rounded-[1px]" style={{ backgroundColor: SEVERITY_COLOR[severity] }} />
      <h3 className="type-poster text-[17px] tracking-[0.02em] text-ink">{severity}</h3>
      <span className="label num ml-auto">{pluralize(count, 'finding')}</span>
    </div>
  );
}

function place(asset: MediaAsset): string {
  return asset.zone ? `${asset.site} · ${asset.zone}` : asset.site;
}

const STATUS_DOT: Record<FindingStatus, string> = { open: 'bg-ink', monitoring: 'bg-ink-2', resolved: 'bg-ink-3' };

/**
 * Phone-width status and age, as one quiet line (the badge column only appears from md up).
 * `site` is appended only while the row's @container is too narrow to show it beside the title.
 */
function StatusLine({ status, when, site }: { status: FindingStatus; when: string; site?: string }) {
  return (
    <span className="mt-1 flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-ink-3 md:hidden">
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[status])} />
      <span className={cn('shrink-0', status === 'open' ? 'text-ink' : 'text-ink-2')}>{STATUS_LABEL[status]}</span>
      <span aria-hidden>·</span>
      <span className="num truncate">
        {when}
        {site && <span className="font-sans text-[11.5px] @sm:hidden"> · {site}</span>}
      </span>
    </span>
  );
}

function FindingRow({ record, now, onInspect }: { record: FindingRecord; now: number; onInspect: (assetId: string) => void }) {
  const { finding, asset } = record;
  const tier = TIER[finding.severity];
  const when = captureWhen(asset, now);
  const open = () => onInspect(asset.id);

  if (tier === 'major') {
    return (
      <button
        type="button"
        data-cursor="OPEN"
        onClick={open}
        className="grid w-full grid-cols-[112px_minmax(0,1fr)] items-start gap-4 px-4 py-4 text-left transition-colors hover:bg-raised sm:grid-cols-[152px_minmax(0,1fr)] md:grid-cols-[152px_minmax(0,1fr)_132px]"
      >
        <Thumb asset={asset} width={152} height={96} />
        <span className="min-w-0">
          <span className="flex items-center gap-2 font-mono text-[11px] text-ink-3">
            {finding.id}
            <span aria-hidden>·</span>
            <span className="font-sans text-[12px]">{CATEGORY_LABEL[finding.category]}</span>
          </span>
          <span className="mt-1 block text-[15px] font-medium leading-snug text-ink">{finding.title}</span>
          <span className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{firstSentence(finding.summary)}</span>
          {aiAnalysed(asset) && asset.ai?.caption && (
            <span className="mt-1.5 flex min-w-0 items-center gap-1.5" title={`AI detected · Cloudinary caption: ${asset.ai.caption}`}>
              <ProvenanceBadge kind="ai" className="py-0 text-[9.5px]" />
              <span className="min-w-0 truncate text-[12px] text-ink-3">{asset.ai.caption}</span>
            </span>
          )}
          <span className="mt-2 block truncate text-[12px] text-ink-3">{place(asset)}</span>
          <span className="mt-2.5 flex flex-wrap items-center gap-2 md:hidden">
            <StatusBadge status={finding.status} />
            <span className="num font-mono text-[11px] text-ink-3" title={when.title}>
              {when.relative}
            </span>
          </span>
        </span>
        <span className="hidden flex-col items-end gap-2.5 md:flex">
          <StatusBadge status={finding.status} />
          <When when={when} className="items-end text-right" />
        </span>
      </button>
    );
  }

  const minor = tier === 'minor';
  return (
    <button
      type="button"
      data-cursor="OPEN"
      onClick={open}
      className={cn(
        'group grid w-full items-center text-left transition-colors hover:bg-raised',
        // Status and age share one column grid across medium and low rows, so the badges line up.
        minor
          ? 'grid-cols-[52px_minmax(0,1fr)] gap-3 px-4 py-2 md:grid-cols-[52px_minmax(0,1fr)_84px_104px]'
          : 'grid-cols-[76px_minmax(0,1fr)] gap-3.5 px-4 py-3 md:grid-cols-[76px_minmax(0,1fr)_84px_104px]',
      )}
    >
      <Thumb
        asset={asset}
        width={minor ? 52 : 76}
        height={minor ? 32 : 48}
        className={cn(minor && 'opacity-80 transition-opacity group-hover:opacity-100')}
      />
      {minor ? (
        // Sized by its own width, not the viewport: the site sits beside the title only when both fit,
        // otherwise it moves to the status line (phones) or the hover title (the narrow two-column layout).
        <span className="@container min-w-0" title={`${finding.title} · ${asset.site}`}>
          <span className="flex min-w-0 items-baseline gap-2.5">
            <span className="truncate text-[13px] text-ink-2 transition-colors group-hover:text-ink">{finding.title}</span>
            <span className="hidden shrink-0 truncate text-[11.5px] text-ink-3 @sm:inline">{asset.site}</span>
          </span>
          <StatusLine status={finding.status} when={when.relative} site={asset.site} />
        </span>
      ) : (
        <span className="min-w-0">
          <span className="line-clamp-2 text-[13.5px] font-medium leading-snug text-ink">{finding.title}</span>
          <span className="mt-0.5 block truncate text-[12px] text-ink-3" title={`${place(asset)} · ${CATEGORY_LABEL[finding.category]}`}>
            <span className="font-mono text-[11px]">{finding.id}</span> · {place(asset)} · {CATEGORY_LABEL[finding.category]}
            {aiAnalysed(asset) && (
              <span className="ml-1.5 font-mono text-[9.5px] uppercase tracking-[0.06em] text-signal/80" title="Cloudinary AI has described this media">
                ai<span className="sr-only"> analysed</span>
              </span>
            )}
          </span>
          <StatusLine status={finding.status} when={when.relative} />
        </span>
      )}
      <When when={when} compact className="hidden md:flex" />
      <span className="hidden md:block">
        <StatusBadge status={finding.status} />
      </span>
    </button>
  );
}

/** Age, and (unless compact) the absolute time; the hover title says when a time is a sample or a camera clock. */
function When({ when, compact, className }: { when: CaptureWhen; compact?: boolean; className?: string }) {
  return (
    <span className={cn('flex min-w-0 flex-col', className)} title={when.title}>
      <span className="num truncate font-mono text-[11.5px] text-ink-2">{when.relative}</span>
      {!compact && <span className="num font-mono text-[10.5px] text-ink-3">{when.absolute}</span>}
    </span>
  );
}

function Thumb({ asset, width, height, className }: { asset: MediaAsset; width: number; height: number; className?: string }) {
  return (
    <span
      className={cn('relative block w-full overflow-hidden rounded-[5px] border border-line bg-raised', className)}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <CloudImage src={thumbUrl(asset, width * 2, height * 2)} alt="" className="h-full w-full object-cover" />
      {asset.resourceType === 'video' && (
        <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-[3px] bg-canvas/75">
          <Film aria-hidden className="h-2.5 w-2.5 text-ink" />
        </span>
      )}
    </span>
  );
}
