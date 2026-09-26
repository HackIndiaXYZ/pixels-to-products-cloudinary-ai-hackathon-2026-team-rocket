'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Film, FileText, Image as ImageIcon, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Category, FindingStatus, ResourceType, Severity } from '@/lib/types';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  SEVERITIES,
  STATUS_LABEL,
  categorySeverityMatrix,
  findingRecords,
  severityCounts,
  sitesOf,
} from '@/lib/analytics';
import { thumbUrl } from '@/lib/cloudinary/media';
import { formatDateTime, relativeTime, titleCase } from '@/lib/format';
import { CloudImage } from '@/components/media/CloudImage';
import { SEVERITY_COLOR, SeverityBadge, SeverityDot, StatusBadge } from '@/components/ui/badges';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/components/ui/cn';
import { useConsole } from '../store';
import { ViewHeader } from './ViewHeader';

const WINDOWS: Array<{ value: string; label: string; days: number | null }> = [
  { value: 'all', label: 'Any time', days: null },
  { value: '1', label: 'Last 24 hours', days: 1 },
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
];

export function IncidentsView() {
  const { assets, now, inspect, reportFor } = useConsole();
  const all = findingRecords(assets);
  const sites = sitesOf(assets);

  const [severities, setSeverities] = useState<Severity[]>([]);
  const [category, setCategory] = useState<'all' | Category>('all');
  const [site, setSite] = useState('all');
  const [windowValue, setWindowValue] = useState('all');
  const [media, setMedia] = useState<'all' | ResourceType>('all');
  const [status, setStatus] = useState<'active' | 'all' | FindingStatus>('active');

  const days = WINDOWS.find((w) => w.value === windowValue)?.days ?? null;

  // Everything except the severity filter — used for the severity toggles and the matrix.
  const base = useMemo(
    () =>
      all.filter(({ finding, asset }) => {
        if (category !== 'all' && finding.category !== category) return false;
        if (site !== 'all' && asset.site !== site) return false;
        if (media !== 'all' && asset.resourceType !== media) return false;
        if (status === 'active' && finding.status === 'resolved') return false;
        if (status !== 'active' && status !== 'all' && finding.status !== status) return false;
        if (days !== null && now - new Date(asset.capturedAt).getTime() > days * 86_400_000) return false;
        return true;
      }),
    [all, category, site, media, status, days, now],
  );
  const records = severities.length ? base.filter((r) => severities.includes(r.finding.severity)) : base;
  const counts = severityCounts(base);
  const matrix = categorySeverityMatrix(base);
  const maxCell = Math.max(1, ...matrix.map((c) => c.count));

  const toggleSeverity = (s: Severity) =>
    setSeverities((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));

  const filtersActive =
    severities.length > 0 || category !== 'all' || site !== 'all' || windowValue !== 'all' || media !== 'all' || status !== 'active';

  const reset = () => {
    setSeverities([]);
    setCategory('all');
    setSite('all');
    setWindowValue('all');
    setMedia('all');
    setStatus('active');
  };

  return (
    <div className="space-y-5">
      <ViewHeader
        title="Incidents"
        subtitle="Visual incident intelligence — every finding, where it is, how severe, and whether it is closed"
        actions={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!records.length}
            onClick={() => reportFor(Array.from(new Set(records.map((r) => r.asset.id))), 'incident')}
          >
            <FileText className="h-3.5 w-3.5" /> Report on these {records.length}
          </button>
        }
      />

      {/* Filters */}
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <select className="input h-8 w-auto text-[12.5px]" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Status">
          <option value="active">Open & monitoring</option>
          <option value="all">All statuses</option>
          {(['open', 'monitoring', 'resolved'] as FindingStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]} only
            </option>
          ))}
        </select>
        <select className="input h-8 w-auto text-[12.5px]" value={category} onChange={(e) => setCategory(e.target.value as 'all' | Category)} aria-label="Category">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select className="input h-8 w-auto text-[12.5px]" value={site} onChange={(e) => setSite(e.target.value)} aria-label="Location">
          <option value="all">All locations</option>
          {sites.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select className="input h-8 w-auto text-[12.5px]" value={windowValue} onChange={(e) => setWindowValue(e.target.value)} aria-label="Date">
          {WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
        <Segmented
          size="sm"
          ariaLabel="Media type"
          value={media}
          onChange={setMedia}
          options={[
            { value: 'all', label: 'All media' },
            { value: 'image', label: <><ImageIcon className="h-3 w-3" />Photo</> },
            { value: 'video', label: <><Film className="h-3 w-3" />Video</> },
          ]}
        />
        {filtersActive && (
          <button type="button" onClick={reset} className="btn btn-ghost btn-sm ml-auto">
            <X className="h-3.5 w-3.5" /> Reset
          </button>
        )}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {/* Severity toggles */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SEVERITIES.map((s) => {
              const active = severities.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleSeverity(s)}
                  className={cn(
                    'panel flex items-center justify-between px-3.5 py-3 text-left transition-colors',
                    active ? 'border-line-strong bg-raised' : 'hover:border-line-strong',
                    severities.length > 0 && !active && 'opacity-50',
                  )}
                >
                  <span className="flex items-center gap-2 text-[13px] font-medium">
                    <SeverityDot severity={s} />
                    {titleCase(s)}
                  </span>
                  <span className="num text-[20px] font-semibold tracking-[-0.02em]" style={{ color: counts[s] ? SEVERITY_COLOR[s] : undefined }}>
                    {counts[s]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Findings */}
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="label">{records.length} findings · worst first</span>
            </div>
            {records.length === 0 ? (
              <div className="px-4 py-12 text-center text-[13px] text-ink-3">No findings match. Widen the filters or change the date window.</div>
            ) : (
              <ul className="divide-y divide-line">
                <AnimatePresence initial={false}>
                  {records.map(({ finding, asset }) => (
                    <motion.li
                      key={finding.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.18 }}
                    >
                      <button
                        type="button"
                        onClick={() => inspect(asset.id)}
                        className="grid w-full grid-cols-[80px_minmax(0,1fr)] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised md:grid-cols-[80px_minmax(0,1fr)_110px_150px_100px]"
                      >
                        <span className="relative h-[50px] w-[80px] overflow-hidden rounded-[6px] border border-line bg-raised">
                          <CloudImage src={thumbUrl(asset, 160, 100)} alt="" className="h-full w-full object-cover" />
                          {asset.resourceType === 'video' && (
                            <Film className="absolute bottom-1 right-1 h-3 w-3 text-ink drop-shadow" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-ink-3">{finding.id}</span>
                            <span className="md:hidden">
                              <SeverityBadge severity={finding.severity} />
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-[13.5px] font-medium">{finding.title}</span>
                          <span className="block truncate text-[12px] text-ink-3">
                            {asset.site}
                            {asset.zone ? ` · ${asset.zone}` : ''} · <CategoryName category={finding.category} />
                          </span>
                        </span>
                        <span className="hidden md:block">
                          <SeverityBadge severity={finding.severity} />
                        </span>
                        <span className="hidden flex-col md:flex">
                          <span className="num font-mono text-[11.5px] text-ink-2">{relativeTime(asset.capturedAt, now)}</span>
                          <span className="num font-mono text-[10.5px] text-ink-3">{formatDateTime(asset.capturedAt)}</span>
                        </span>
                        <span className="hidden md:block">
                          <StatusBadge status={finding.status} />
                        </span>
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            )}
          </div>
        </div>

        {/* Matrix */}
        <aside className="panel h-fit p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[13.5px] font-semibold">Category × severity</h2>
            <span className="font-mono text-[10.5px] text-ink-3">click to filter</span>
          </div>
          <div className="mt-3 grid grid-cols-[88px_repeat(4,minmax(0,1fr))] gap-1 text-[11px]">
            <span />
            {SEVERITIES.map((s) => (
              <span key={s} className="flex items-center justify-center gap-1 pb-1 font-mono text-[10px] uppercase text-ink-3">
                <SeverityDot severity={s} />
                {s.slice(0, 4)}
              </span>
            ))}
            {CATEGORIES.map((c) => (
              <MatrixRow
                key={c}
                category={c}
                cells={matrix.filter((m) => m.category === c)}
                max={maxCell}
                active={(sev) => category === c && severities.length === 1 && severities[0] === sev}
                onPick={(sev) => {
                  setCategory(c);
                  setSeverities([sev]);
                }}
              />
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
            Severity comes from the structured record for each capture. Counts respect every filter except severity.
          </p>
        </aside>
      </div>
    </div>
  );
}

function CategoryName({ category }: { category: Category }) {
  return <>{CATEGORY_LABEL[category]}</>;
}

function MatrixRow({
  category,
  cells,
  max,
  active,
  onPick,
}: {
  category: Category;
  cells: Array<{ severity: Severity; count: number }>;
  max: number;
  active: (s: Severity) => boolean;
  onPick: (s: Severity) => void;
}) {
  return (
    <>
      <span className="flex items-center text-[12px] text-ink-2">{CATEGORY_LABEL[category]}</span>
      {cells.map((cell) => (
        <button
          key={cell.severity}
          type="button"
          disabled={!cell.count}
          onClick={() => onPick(cell.severity)}
          title={`${cell.count} ${cell.severity} ${CATEGORY_LABEL[category].toLowerCase()} findings`}
          className={cn(
            'num flex h-9 items-center justify-center rounded-[6px] border font-mono text-[12px] transition-transform',
            cell.count ? 'border-transparent hover:scale-[1.04]' : 'border-line text-ink-3/50',
            active(cell.severity) && 'ring-2 ring-signal ring-offset-2 ring-offset-surface',
          )}
          style={
            cell.count
              ? {
                  backgroundColor: `color-mix(in oklab, ${SEVERITY_COLOR[cell.severity]} ${Math.round(18 + (cell.count / max) * 50)}%, var(--color-surface))`,
                  color: 'var(--color-ink)',
                }
              : undefined
          }
        >
          {cell.count || '·'}
        </button>
      ))}
    </>
  );
}

