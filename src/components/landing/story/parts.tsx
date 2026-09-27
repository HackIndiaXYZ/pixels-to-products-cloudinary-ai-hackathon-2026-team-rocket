'use client';

import Link from 'next/link';
import { ArrowUpRight, Search } from 'lucide-react';
import { CATEGORY_LABEL } from '@/lib/analytics';
import { CROP_LABEL, faceDetections, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import { CategoryTag, SEVERITY_COLOR, SeverityBadge, SeverityDot, StatusBadge } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import {
  COUNTS,
  DATASET,
  HERO,
  HERO_RANK,
  HERO_SITE,
  QUERY_PARSED,
  QUERY_RESULT,
  RECORDS,
  STORY_QUERY,
  UNDERSTOOD,
} from './data';
import { shortHash } from './hooks';

/* ------------------------------------------------------------------------ */
/* Search                                                                    */
/* ------------------------------------------------------------------------ */

/** Query split into words; words the parser consumed get an underline slot (`u`). */
const TOKENS: Array<{ text: string; u: number }> = (() => {
  let u = 0;
  return STORY_QUERY.split(/(\s+)/).map((text) => ({
    text,
    u: UNDERSTOOD.has(text.trim().toLowerCase()) ? u++ : -1,
  }));
})();

/**
 * The query bar with the parser's real interpretation. With `live`, the
 * pinned scene's renderer types the text and reveals the chips (it finds the
 * parts through their `data-sc` markers); otherwise it renders complete.
 */
export function QueryPanel({ live = false }: { live?: boolean }) {
  return (
    <div>
      <div className="flex h-12 items-center gap-3 rounded-[8px] border border-line-strong bg-surface px-3.5">
        <Search className="h-4 w-4 shrink-0 text-signal" aria-hidden />
        <span className="min-w-0 whitespace-nowrap text-[15px] text-ink">
          {live && <span data-sc="typed" />}
          <span data-sc={live ? 'rich' : undefined} className={live ? 'hidden' : undefined}>
            {TOKENS.map((tok, i) => {
              if (tok.u < 0) return <span key={i}>{tok.text}</span>;
              return (
                <span key={i} className="relative">
                  {tok.text}
                  <span
                    data-sc={live ? 'underline' : undefined}
                    aria-hidden
                    className="absolute inset-x-0 -bottom-[3px] h-[1.5px] origin-left bg-signal"
                    style={live ? { transform: 'scaleX(0)' } : undefined}
                  />
                </span>
              );
            })}
          </span>
          {live && <span data-sc="caret" aria-hidden className="ml-px inline-block h-[1.05em] w-[1.5px] bg-signal align-[-0.18em] opacity-0" />}
        </span>
      </div>
      <div data-sc={live ? 'chips' : undefined} className="mt-3 flex flex-wrap items-center gap-1.5">
        <span className="label mr-1">Understood as</span>
        {QUERY_PARSED.severities.map((s) => (
          <span
            key={s}
            className="chip"
            style={{ color: SEVERITY_COLOR[s], borderColor: `color-mix(in oklab, ${SEVERITY_COLOR[s]} 38%, transparent)` }}
          >
            severity · {s}
          </span>
        ))}
        {QUERY_PARSED.categories.map((c) => (
          <span key={c} className="chip text-signal">
            category · {CATEGORY_LABEL[c].toLowerCase()}
          </span>
        ))}
        {QUERY_PARSED.sites.map((s) => (
          <span key={s} className="chip text-signal">
            site · {s}
          </span>
        ))}
        {QUERY_RESULT.keywords.map((k) => (
          <span key={k} className="chip">
            keyword · {k}
          </span>
        ))}
      </div>
      <div data-sc={live ? 'result' : undefined} className="mt-3 font-mono text-[11px] text-ink-2">
        <span className="num text-ink">{QUERY_RESULT.hits.length}</span> of <span className="num">{DATASET.captures}</span> captures match ·
        ranked worst first
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Structure                                                                 */
/* ------------------------------------------------------------------------ */

/** One capture as the structured record VisualOps keeps for it. */
export function RecordPanel({ className }: { className?: string }) {
  const f = HERO.finding!;
  const rows: Array<[string, string]> = [
    ['file', HERO.fileName],
    ['site', HERO.site],
    ['zone', HERO.zone ?? '—'],
    ['category', CATEGORY_LABEL[f.category].toLowerCase()],
    ['severity', f.severity],
    ['status', f.status],
    ['cloudinary', `${HERO.cloudName}/${HERO.publicId}`],
    ['tags', HERO.tags.slice(0, 5).join(', ')],
  ];
  return (
    <div className={className}>
      <p className="label">
        Record · <span className="text-ink-2">{f.id}</span>
      </p>
      <dl className="mt-3 grid grid-cols-[82px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line pt-3 font-mono text-[11px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-3">{k}</dt>
            <dd className="truncate text-ink" style={k === 'severity' ? { color: SEVERITY_COLOR[f.severity] } : undefined}>
              {v}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 font-mono text-[10.5px] tracking-[0.04em] text-ink-3">Sample annotation · fields travel as Cloudinary tags + context</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Insight                                                                   */
/* ------------------------------------------------------------------------ */

export function InsightPanel({ className }: { className?: string }) {
  const f = HERO.finding!;
  const onlyCritical = COUNTS.critical === 1 && f.severity === 'critical';
  return (
    <div className={className}>
      <p className="label">Ranked from the records</p>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <SeverityBadge severity={f.severity} />
        <CategoryTag category={f.category} />
        <StatusBadge status={f.status} />
      </div>
      <h3 className="type-heading mt-4 text-[22px] text-ink sm:text-[26px]">{f.title}</h3>
      <p className="mt-1.5 text-[14px] text-ink-2">
        {HERO.site}
        {HERO.zone ? ` · ${HERO.zone}` : ''}
      </p>
      <dl className="mt-4 grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line pt-3 font-mono text-[11px]">
        <dt className="text-ink-3">rank</dt>
        <dd className="text-ink">
          <span className="num">{HERO_RANK}</span> of <span className="num">{RECORDS.length}</span> findings
          {onlyCritical ? ' · the only critical' : ''}
        </dd>
        {HERO_SITE && (
          <>
            <dt className="text-ink-3">site</dt>
            <dd className="text-ink-2">
              <span className="num">{HERO_SITE.open}</span> open at {HERO_SITE.site}
            </dd>
          </>
        )}
        {/* Secondary rows: dropped on short phones in the pinned scene (data-dense). */}
        <dt className="text-ink-3 in-data-[dense=true]:hidden">file</dt>
        <dd className="truncate text-ink-2 in-data-[dense=true]:hidden">{HERO.fileName}</dd>
        <dt className="text-ink-3 in-data-[dense=true]:hidden">source</dt>
        <dd className="truncate text-ink-2 in-data-[dense=true]:hidden">{HERO.capturedBy}</dd>
      </dl>
      <p className="mt-3 font-mono text-[10.5px] tracking-[0.04em] text-ink-3">Sample annotation</p>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Action                                                                    */
/* ------------------------------------------------------------------------ */

export function ActionPanel({ className }: { className?: string }) {
  return (
    <div className={className}>
      <p className="label">Evidence package</p>
      <p className="mt-3 max-w-[32ch] text-[14px] leading-relaxed text-ink-2">
        Each finding in scope with its stamped frame, the next action and a fingerprint of the payload.
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {['PDF', 'Markdown', 'JSON', 'CSV'].map((fmt) => (
          <span key={fmt} className="chip bg-transparent">
            {fmt}
          </span>
        ))}
      </div>
      <Link href="/console" data-cursor="OPEN" className="link-underline mt-5 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink">
        Build a report in the console <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Paper inspection report built from the search result. The evidence frame is
 * rendered by Cloudinary (exposure, e_pixelate_faces on any faces it detects,
 * burned-in audit stamp); the fingerprint is a SHA-256 of a fixed sample report
 * payload (see `reportJson`) computed in this browser — the payload carries the
 * same evidence URL this sheet displays. With `live`, the pinned scene reveals
 * the frame and fingerprint itself.
 */
export function ReportSheet({
  evidenceSrc,
  hash,
  live = false,
  onEvidenceLoad,
  className,
}: {
  evidenceSrc: string | null;
  hash: string | null;
  live?: boolean;
  onEvidenceLoad?: (img: HTMLImageElement) => void;
  className?: string;
}) {
  const f = HERO.finding!;
  const others = QUERY_RESULT.hits.filter((h) => h.asset.id !== HERO.id);
  return (
    <div className={cn('rounded-[6px] bg-paper p-4 text-paper-ink sm:p-5', className)}>
      <div className="flex items-baseline justify-between gap-3 border-b border-black/10 pb-2.5 font-mono text-[10px] uppercase tracking-[0.08em] text-black/55">
        <span>VisualOps · Inspection report</span>
        <span className="num">{QUERY_RESULT.hits.length} findings</span>
      </div>
      <p className="mt-2 hidden truncate font-mono sm:block text-[10px] text-black/50">Scope · search “{STORY_QUERY}”</p>

      <div className="mt-3 flex items-center gap-2 font-mono text-[10.5px]">
        <span className="text-black/55">{f.id}</span>
        <span
          className="inline-flex items-center gap-1.5 font-semibold uppercase tracking-[0.06em]"
          style={{ color: `color-mix(in oklab, ${SEVERITY_COLOR[f.severity]} 78%, black)` }}
        >
          <SeverityDot severity={f.severity} />
          {f.severity}
        </span>
        <span className="text-black/55">· {f.status}</span>
      </div>
      <p className="mt-1 text-[14.5px] font-semibold leading-snug tracking-[-0.01em]">{f.title}</p>
      <p className="mt-0.5 truncate text-[11.5px] text-black/60">
        {HERO.site}
        {HERO.zone ? ` · ${HERO.zone}` : ''} · {HERO.fileName}
      </p>

      <div
        data-sc={live ? 'slot' : undefined}
        className="relative mt-3 w-full overflow-hidden rounded-[3px] bg-black/[0.06]"
        style={{ aspectRatio: `${HERO.width} / ${HERO.height}` }}
      >
        <span className="absolute inset-0 grid place-items-center px-4 text-center font-mono text-[10px] text-black/45">
          Cloudinary is rendering the stamped frame…
        </span>
        {evidenceSrc && (
          // eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition
          <img
            data-sc={live ? 'evidence' : undefined}
            src={evidenceSrc}
            alt={`Evidence frame for ${f.id}, stamped by Cloudinary`}
            decoding="async"
            loading={live ? undefined : 'lazy'}
            onLoad={onEvidenceLoad ? (e) => onEvidenceLoad(e.currentTarget) : undefined}
            className={cn('absolute inset-0 h-full w-full object-cover', live && 'opacity-0')}
          />
        )}
      </div>
      <p className="mt-1.5 truncate font-mono text-[9.5px] text-black/45 in-data-[dense=true]:hidden">
        Cloudinary · e_improve · e_pixelate_faces · l_text audit stamp
      </p>

      <p className="mt-2.5 hidden text-[11.5px] sm:line-clamp-2 leading-relaxed text-black/70">
        <span className="font-medium text-black/85">Action · </span>
        {f.action}
      </p>

      {others.map(({ asset }) => (
        <div
          key={asset.id}
          className="mt-2.5 flex items-center gap-2 border-t border-black/10 pt-2 font-mono text-[10px] text-black/60 in-data-[dense=true]:hidden"
        >
          <span className="shrink-0 whitespace-nowrap">{asset.finding?.id}</span>
          {asset.finding && <SeverityDot severity={asset.finding.severity} />}
          <span className="min-w-0 truncate font-sans text-[11.5px] text-black/75">{asset.finding?.title}</span>
          <span className="ml-auto shrink-0">{asset.site}</span>
        </div>
      ))}

      {/* The digest is computed over a fixed sample report payload (reportJson) that names exactly the frame shown above. */}
      <div
        data-sc={live ? 'hash' : undefined}
        className={cn('mt-2.5 border-t border-black/10 pt-2 font-mono text-[9.5px] text-black/55', live && 'opacity-0')}
      >
        <div className="truncate">SHA-256 · sample report payload</div>
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <span className="num truncate text-black/80">{shortHash(hash)}</span>
          <span className="shrink-0 text-[10px]" title="Human classified · sample annotations written by the VisualOps team">
            Sample annotations
          </span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Understand legend                                                         */
/* ------------------------------------------------------------------------ */

export function InsightLegend({ insights }: { insights: Record<string, CloudinaryInsight> }) {
  const values = Object.values(insights);
  const faces = values.reduce((n, v) => n + v.faces.length, 0);
  return (
    <div className="mt-3 space-y-1.5 font-mono text-[10.5px] text-ink-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-3.5 rounded-[2px] border border-dashed border-signal" />
          {CROP_LABEL} (1:1)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] border border-signal bg-signal/15" />
          face detection
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-3.5 rounded-[2px] border border-high" />
          sample annotation
        </span>
      </div>
      <div className="text-ink-2">
        {values.length
          ? `Live from Cloudinary fl_getinfo · ${values.length > 1 ? `${values.length} captures · ` : ''}${faceDetections(faces)}`
          : 'Asking Cloudinary fl_getinfo…'}
      </div>
    </div>
  );
}
