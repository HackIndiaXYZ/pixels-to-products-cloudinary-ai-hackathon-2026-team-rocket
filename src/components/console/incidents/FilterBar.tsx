'use client';

import { Film, Image as ImageIcon, X } from 'lucide-react';
import type { Category, Severity } from '@/lib/types';
import { CATEGORIES, CATEGORY_LABEL, SEVERITIES, type StatusCounts } from '@/lib/analytics';
import { titleCase } from '@/lib/format';
import { SeverityDot } from '@/components/ui/badges';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/components/ui/cn';
import { STATUS_FILTERS, WINDOWS, filtersActive, type IncidentFilters, type StatusFilter } from './model';

/** Compact selects; 16px on touch screens so iOS Safari does not zoom the page on focus. */
const SELECT = 'input h-8 w-auto max-w-full text-[12.5px] pointer-coarse:h-9 pointer-coarse:text-base';

/**
 * Two quiet rows: severity (with live counts inside the current scope) and the
 * scope itself — status, category, location, date window and media type.
 */
export function FilterBar({
  filters,
  onChange,
  onReset,
  counts,
  statusCounts,
  sites,
  inView,
}: {
  filters: IncidentFilters;
  onChange: (patch: Partial<IncidentFilters>) => void;
  onReset: () => void;
  /** Findings per severity within every filter except severity. */
  counts: Record<Severity, number>;
  /** Findings per status within every filter except status. */
  statusCounts: StatusCounts;
  sites: string[];
  inView: number;
}) {
  const anyOn = filters.severities.length > 0;
  const toggle = (s: Severity) =>
    onChange({
      severities: filters.severities.includes(s) ? filters.severities.filter((x) => x !== s) : [...filters.severities, s],
    });

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
        <span className="label hidden w-[58px] shrink-0 sm:block">Severity</span>
        <div role="group" aria-label="Severity" className="flex flex-wrap items-center gap-1">
          {SEVERITIES.map((s) => {
            const on = filters.severities.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(s)}
                className={cn(
                  'inline-flex h-7 items-center gap-2 rounded-[6px] border px-2.5 text-[12.5px] font-medium transition-colors pointer-coarse:h-9',
                  on ? 'border-line-strong bg-raised text-ink' : 'border-transparent hover:bg-raised hover:text-ink',
                  !on && (anyOn ? 'text-ink-3' : 'text-ink-2'),
                )}
              >
                <SeverityDot severity={s} className={cn(anyOn && !on && 'opacity-50')} />
                {titleCase(s)}{' '}
                <span className={cn('num font-mono text-[11px]', on ? 'text-ink' : 'text-ink-3')} title="System derived · findings counted in scope">
                  {counts[s]}
                </span>
              </button>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="font-mono text-[11px] text-ink-3" aria-live="polite" aria-atomic="true" title="System derived · findings counted in view">
            <span className="num text-ink-2">{inView}</span> in view
          </span>
          {filtersActive(filters) && (
            <button type="button" onClick={onReset} className="btn btn-ghost btn-sm">
              <X className="h-3.5 w-3.5" /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <span className="label hidden w-[58px] shrink-0 sm:block">Scope</span>
        <select name="status"
          className={SELECT}
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value as StatusFilter })}
          aria-label="Status"
          title="Open: status open only. Unresolved: open + monitoring."
        >
          {STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} · {statusCounts[option.count]}
            </option>
          ))}
        </select>
        <select name="category"
          className={SELECT}
          value={filters.category}
          onChange={(e) => onChange({ category: e.target.value as 'all' | Category })}
          aria-label="Category"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select name="site" className={SELECT} value={filters.site} onChange={(e) => onChange({ site: e.target.value })} aria-label="Location">
          <option value="all">All locations</option>
          {sites.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select name="window" className={SELECT} value={filters.window} onChange={(e) => onChange({ window: e.target.value })} aria-label="Date">
          {WINDOWS.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
        <Segmented
          size="sm"
          ariaLabel="Media type"
          value={filters.media}
          onChange={(media) => onChange({ media })}
          options={[
            { value: 'all', label: 'All media' },
            {
              value: 'image',
              label: (
                <>
                  <ImageIcon aria-hidden className="h-3 w-3" />
                  Photo
                </>
              ),
            },
            {
              value: 'video',
              label: (
                <>
                  <Film aria-hidden className="h-3 w-3" />
                  Video
                </>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
