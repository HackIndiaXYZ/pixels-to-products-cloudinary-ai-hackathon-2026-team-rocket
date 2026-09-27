'use client';

import { CloudUpload, Film, Image as ImageIcon, LayoutGrid, Rows3, Search, X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { Category, MediaAsset, Severity } from '@/lib/types';
import { CATEGORIES, CATEGORY_LABEL, SEVERITIES, fieldAssets, sitesOf } from '@/lib/analytics';
import { titleCase } from '@/lib/format';
import { SeverityDot } from '@/components/ui/badges';
import { ProvenanceBadge } from '@/components/ui/Provenance';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/components/ui/cn';
import { LibraryEmpty } from '../library/LibraryEmpty';
import { LibraryGrid, LoadMore } from '../library/LibraryGrid';
import { LibraryList } from '../library/LibraryList';
import {
  DEFAULT_FILTERS,
  SORT_LABEL,
  SOURCE_LABEL,
  activeFilterCount,
  aiOnlyTerms,
  describeFilters,
  facetCounts,
  hasSampleTimes,
  matches,
  poolFor,
  sortAssets,
  type LibraryFilters,
  type SortOrder,
  type SourceFilter,
  type TypeFilter,
} from '../library/model';
import { aiAnalysed } from '../incidents/model';
import { warmInspector } from '../library/renditions';
import { publishLibrarySequence } from '../library/sequence';
import { useConsoleActions, useConsoleData, useConsoleUi } from '../store';
import { ViewHeader } from './ViewHeader';

/** Tiles rendered per page (lazy images keep actual loads to what is on screen); more load near the end. */
const PAGE = 40;
const LAYOUT_STORAGE_KEY = 'visualops.library.layout.v1';
// 16px on touch screens, so iOS Safari doesn't zoom the page when a select is focused.
const SELECT = 'input h-8 w-auto max-w-full text-[12.5px] pointer-coarse:text-base';

type Layout = 'grid' | 'list';

function readLayout(): Layout {
  try {
    return window.localStorage.getItem(LAYOUT_STORAGE_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

/**
 * Memoised and subscribed only to data and the stable actions, so opening Ask,
 * a dialog or the Inspector never re-renders the header and filters. Only
 * <Results> follows the open record, and only to mark its tile.
 */
export const LibraryView = memo(function LibraryView() {
  const { assets, now } = useConsoleData();
  const { inspect, setIngestOpen } = useConsoleActions();
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);
  const [sort, setSort] = useState<SortOrder>('newest');
  const [layout, setLayoutState] = useState<Layout>(readLayout);
  const [limit, setLimit] = useState(PAGE);

  const patch = useCallback((next: Partial<LibraryFilters>) => {
    setFilters((prev) => ({ ...prev, ...next }));
    setLimit(PAGE);
  }, []);
  const clear = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setLimit(PAGE);
  }, []);
  const setLayout = (next: Layout) => {
    setLayoutState(next);
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, next);
    } catch {
      /* storage unavailable — the choice still applies for this visit */
    }
  };

  const field = useMemo(() => fieldAssets(assets), [assets]);
  const sites = useMemo(() => sitesOf(assets), [assets]);
  const pool = useMemo(() => poolFor(assets), [assets]);
  const results = useMemo(() => sortAssets(pool.filter((a) => matches(a, filters)), sort), [pool, filters, sort]);
  const facets = useMemo(() => facetCounts(pool, filters), [pool, filters]);
  const visible = useMemo(() => results.slice(0, limit), [results, limit]);
  const sampleTimes = useMemo(() => hasSampleTimes(field), [field]);
  const analysed = useMemo(() => field.filter(aiAnalysed).length, [field]);

  // Share the result order so the Inspector's ← / → follow exactly this view. The mosaic
  // adds the on-screen order of the rendered page on top (see library/sequence).
  useEffect(() => {
    publishLibrarySequence(results.map((a) => a.id));
  }, [results]);
  useEffect(() => () => publishLibrarySequence([]), []);

  const open = useCallback((asset: MediaAsset) => inspect(asset.id), [inspect]);
  const more = useCallback(() => setLimit((l) => l + PAGE), []);
  const toggleSeverity = (s: Severity) =>
    patch({ severities: filters.severities.includes(s) ? filters.severities.filter((x) => x !== s) : [...filters.severities, s] });

  const active = activeFilterCount(filters);
  const photos = field.filter((a) => a.resourceType === 'image').length;
  const anySeverity = filters.severities.length > 0;

  return (
    <div>
      <ViewHeader
        title="Library"
        subtitle={
          <>
            <span className="num">{field.length}</span> field captures · <span className="num">{photos}</span> photos ·{' '}
            <span className="num">{field.length - photos}</span> videos across <span className="num">{sites.length}</span> sites. Every frame, crop and
            preview is rendered by Cloudinary.
            {analysed > 0 && (
              <>
                {' '}
                <span className="num">{analysed}</span> described by Cloudinary AI — search covers their captions, objects and
                auto-tags.
              </>
            )}
            {sampleTimes && ' Sample capture times are relative to now.'}
          </>
        }
        actions={
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIngestOpen(true)}>
            <CloudUpload className="h-3.5 w-3.5" /> Ingest or sync
          </button>
        }
      />

      {/* Controls stay reachable while scrolling a large library (desktop). */}
      <div className="mt-5 bg-canvas lg:sticky lg:top-[52px] lg:z-20 lg:mt-1 lg:pb-3 lg:pt-4">
        <div className="panel">
          <div className="flex flex-wrap items-center gap-2 p-2">
            <label className="relative min-w-[220px] flex-1">
              <span className="sr-only">Filter library</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-3" />
              <input
                value={filters.query}
                onChange={(e) => patch({ query: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && filters.query) {
                    e.stopPropagation();
                    patch({ query: '' });
                  }
                }}
                placeholder={analysed > 0 ? 'Search file, finding ID, site, tag, AI caption…' : 'Search file, finding ID, site, tag…'}
                className="input pl-8 pr-8"
                spellCheck={false}
              />
              {filters.query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => patch({ query: '' })}
                  className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-[5px] text-ink-3 hover:bg-raised hover:text-ink"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <Segmented<TypeFilter>
              ariaLabel="Media type"
              value={filters.type}
              onChange={(type) => patch({ type })}
              options={[
                { value: 'all', label: <>All <Count n={facets.type.all} /></> },
                { value: 'image', label: <><ImageIcon className="h-3.5 w-3.5" />Photos <Count n={facets.type.image} /></> },
                { value: 'video', label: <><Film className="h-3.5 w-3.5" />Videos <Count n={facets.type.video} /></> },
              ]}
            />
            <select className={SELECT} value={sort} onChange={(e) => setSort(e.target.value as SortOrder)} aria-label="Sort">
              {(Object.keys(SORT_LABEL) as SortOrder[]).map((o) => (
                <option key={o} value={o}>
                  {SORT_LABEL[o]}
                </option>
              ))}
            </select>
            <Segmented<Layout>
              ariaLabel="Layout"
              value={layout}
              onChange={setLayout}
              options={[
                { value: 'grid', label: <LayoutGrid className="h-3.5 w-3.5" />, title: 'Mosaic' },
                { value: 'list', label: <Rows3 className="h-3.5 w-3.5" />, title: 'List' },
              ]}
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line px-2 py-2">
            <div role="group" aria-label="Severity" className="flex flex-wrap items-center gap-1">
              {SEVERITIES.map((s) => {
                const on = filters.severities.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleSeverity(s)}
                    className={cn(
                      'inline-flex h-7 items-center gap-2 rounded-[6px] border px-2.5 text-[12.5px] font-medium transition-colors',
                      on ? 'border-line-strong bg-raised text-ink' : 'border-transparent hover:bg-raised hover:text-ink',
                      !on && (anySeverity ? 'text-ink-3' : 'text-ink-2'),
                    )}
                  >
                    <SeverityDot severity={s} className={cn(anySeverity && !on && 'opacity-50')} />
                    {titleCase(s)}
                    <span className={cn('num font-mono text-[11px]', on ? 'text-ink' : 'text-ink-3')}>{facets.severity[s]}</span>
                  </button>
                );
              })}
            </div>
            <span aria-hidden className="hidden h-4 w-px bg-line md:block" />
            <select
              className={SELECT}
              value={filters.category}
              onChange={(e) => patch({ category: e.target.value as 'all' | Category })}
              aria-label="Category"
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]} ({facets.category[c]})
                </option>
              ))}
            </select>
            <select className={SELECT} value={filters.site} onChange={(e) => patch({ site: e.target.value })} aria-label="Site">
              <option value="all">All sites</option>
              {sites.map((s) => (
                <option key={s} value={s}>
                  {s} ({facets.site[s] ?? 0})
                </option>
              ))}
            </select>
            <select
              className={SELECT}
              value={filters.source}
              onChange={(e) => patch({ source: e.target.value as SourceFilter })}
              aria-label="Source"
            >
              {(Object.keys(SOURCE_LABEL) as SourceFilter[]).map((s) => (
                <option key={s} value={s}>
                  {SOURCE_LABEL[s]}
                </option>
              ))}
            </select>
            <div className="ml-auto flex items-center gap-2">
              <span className="font-mono text-[11px] text-ink-3" aria-live="polite">
                <span className="num text-ink-2">{results.length}</span> of <span className="num">{pool.length}</span>
              </span>
              {active > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>
                  <X className="h-3.5 w-3.5" /> Clear
                  <span className="num font-mono text-[10.5px] text-ink-3">{active}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4 lg:mt-1">
        <MissingRecordNote />
        {results.length === 0 ? (
          <LibraryEmpty summary={describeFilters(filters)} total={pool.length} onClear={clear} onIngest={() => setIngestOpen(true)} />
        ) : (
          <Results layout={layout} assets={visible} now={now} query={filters.query} onOpen={open} />
        )}
        {results.length > visible.length && <LoadMore key={limit} remaining={results.length - visible.length} page={PAGE} onMore={more} />}
      </div>
    </div>
  );
});

/**
 * The only part of the Library that follows the open record: it marks the
 * selected tile, whose media morphs into the Inspector (the tile must re-render
 * in the same commit as the Inspector mounts for the shared layout to hand
 * off). Grid and list are memoised, so Ask or a dialog opening re-renders this
 * wrapper and nothing below it.
 */
function Results({
  layout,
  assets,
  now,
  query,
  onOpen,
}: {
  layout: Layout;
  assets: MediaAsset[];
  now: number;
  /** The search box, so matches found only in Cloudinary's AI understanding can be labelled. */
  query: string;
  onOpen: (asset: MediaAsset) => void;
}) {
  const { inspectId } = useConsoleUi();
  return (
    <>
      {layout === 'grid' && <AiMatchNote assets={assets} query={query} />}
      {layout === 'grid' ? (
        <LibraryGrid assets={assets} now={now} selectedId={inspectId} onOpen={onOpen} onIntent={warmInspector} />
      ) : (
        <LibraryList assets={assets} now={now} query={query} selectedId={inspectId} onOpen={onOpen} onIntent={warmInspector} />
      )}
    </>
  );
}

/**
 * The mosaic's tiles cannot carry a per-tile source, so it says here how many results the search
 * box found only through Cloudinary's AI understanding (the list view labels each row).
 */
/**
 * A link to a record this workspace doesn't hold (removed from it, or from another cloud) opens nothing,
 * so say so. Shown only once the workspace is known, never while it is still being read.
 */
function MissingRecordNote() {
  const { inspectId } = useConsoleUi();
  const { getAsset, workspaceSettled } = useConsoleData();
  const { inspect } = useConsoleActions();
  if (!workspaceSettled || !inspectId || getAsset(inspectId)) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] border border-line bg-surface px-3 py-2 text-[12.5px] text-ink-2">
      <span className="min-w-0">
        No record <span className="break-all font-mono text-ink">{inspectId}</span> in this workspace. It may have been removed, or it
        belongs to another cloud.
      </span>
      <button type="button" className="btn btn-ghost btn-sm ml-auto" onClick={() => inspect(null)}>
        <X className="h-3.5 w-3.5" /> Dismiss
      </button>
    </div>
  );
}

function AiMatchNote({ assets, query }: { assets: MediaAsset[]; query: string }) {
  const viaAi = useMemo(() => (query.trim() ? assets.filter((a) => aiOnlyTerms(a, query).length > 0) : []), [assets, query]);
  if (!viaAi.length) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-3">
      <ProvenanceBadge kind="ai" detail="Cloudinary" />
      <span>
        <span className="num text-ink-2">{viaAi.length}</span> of these {viaAi.length === 1 ? 'matches' : 'match'} “{query.trim()}” only
        in Cloudinary’s caption, detected objects or auto-tags — not in the human-classified record.
      </span>
    </p>
  );
}

function Count({ n }: { n: number }) {
  return <span className="num font-mono text-[10.5px] text-ink-3">{n}</span>;
}
