'use client';

import { motion } from 'framer-motion';
import { ArrowRight, FileText, Search, Wand2, X } from 'lucide-react';
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MediaAsset } from '@/lib/types';
import { fieldAssets, sitesOf } from '@/lib/analytics';
import { pluralize } from '@/lib/format';
import { filterLabel, relaxations, type Relaxation } from '@/lib/search/query';
import { useDeviceTier, useReducedMotionPref } from '@/components/motion/hooks';
import { Kbd } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { useModKey } from '@/components/ui/useModKey';
import { useConsoleActions, useConsoleData } from '../store';
import {
  ASK_EXAMPLES,
  buildFacets,
  FLIGHT_CAP,
  indexOrder,
  RESULT_PAGE,
  normalizeQuery,
  previewQuery,
  STAGE_MS,
  type AskRun,
} from './engine';
import { useAskSearch } from './useAskSearch';
import { StatusLine } from './StatusLine';
import { IndexStrip, type ThumbState } from './IndexStrip';
import { EvidenceTile } from './EvidenceTile';
import { EvidencePreview } from './EvidencePreview';
import { AskIdle } from './AskIdle';
import { Understanding } from './Understanding';

const RETRY_TERMS = ['crack', 'rebar', 'wet floor', 'Building B', 'critical'];

const plural = pluralize;

/** Stage-2 candidates: records that match any understood filter or keyword. */
function candidatesOf(run: AskRun): Set<string> | null {
  if (!run.filterIds && !run.keywordIds) return null;
  return new Set([...(run.filterIds ?? []), ...(run.keywordIds ?? [])]);
}

/** Where the findings' words come from, for the footer (uploads and syncs are not sample annotations). */
function provenanceNote(pool: MediaAsset[]): string | null {
  const annotated = pool.filter((a) => a.finding);
  if (!annotated.length) return null;
  const samples = annotated.filter((a) => a.source === 'sample').length;
  if (samples === annotated.length) return 'Findings are sample annotations';
  if (samples === 0) return 'Findings recorded at ingest';
  return 'Findings: sample annotations and ingest records';
}

/**
 * Memoised: the palette shell re-renders when other overlays open or close, the body
 * only when the dataset changes or its own state does.
 */
export const AskBody = memo(function AskBody({ onClose }: { onClose: () => void }) {
  const { assets, now } = useConsoleData();
  const { inspect, reportFor, openInStudio } = useConsoleActions();
  const mod = useModKey();
  const tier = useDeviceTier();
  const reduce = useReducedMotionPref();
  const flight = tier === 'high' && !reduce;
  const scope = useId();

  const pool = useMemo(() => fieldAssets(assets), [assets]);
  const sites = useMemo(() => sitesOf(assets), [assets]);
  const strip = useMemo(() => indexOrder(pool), [pool]);
  const stripIds = useMemo(() => new Set(strip.map((a) => a.id)), [strip]);
  const photos = useMemo(() => pool.filter((a) => a.resourceType === 'image').length, [pool]);
  const examples = useMemo(
    () => ASK_EXAMPLES.map((query) => ({ query, ids: previewQuery(query, pool, sites, now) })),
    [pool, sites, now],
  );
  const facets = useMemo(() => buildFacets(pool, sites, now), [pool, sites, now]);
  const provenance = useMemo(() => provenanceNote(pool), [pool]);

  const { query, setQuery, ask: askNow, submit, run, stage, committed, active, setActive } = useAskSearch({
    pool,
    sites,
    now,
    instant: reduce,
  });
  const [exampleActive, setExampleActive] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const keyNav = useRef(false);

  const hits = useMemo(() => committed?.result.hits ?? [], [committed]);
  // Tiles rendered for the committed run (paged, so a large index never loads every image at once).
  const [page, setPage] = useState<{ run: number; count: number }>({ run: 0, count: RESULT_PAGE });
  const shownCount = page.run === committed?.id ? page.count : RESULT_PAGE;
  const keywords = useMemo(() => committed?.result.keywords ?? [], [committed]);
  const activeHit = hits.length ? hits[Math.min(active, hits.length - 1)] : undefined;
  const composing = Boolean(normalizeQuery(query)) && normalizeQuery(query) !== run?.query;
  const running = run !== null && stage < 4;

  // ---- actions -------------------------------------------------------------
  const openHit = useCallback(
    (id: string) => {
      onClose();
      inspect(id);
    },
    [onClose, inspect],
  );
  const report = useCallback(() => {
    if (!hits.length) return;
    onClose();
    reportFor(hits.map((h) => h.asset.id));
  }, [hits, onClose, reportFor]);
  const studio = useCallback(
    (id: string) => {
      onClose();
      openInStudio(id);
    },
    [onClose, openInStudio],
  );
  const ask = useCallback(
    (q: string) => {
      setExampleActive(-1);
      askNow(q);
      inputRef.current?.focus({ preventScroll: true });
    },
    [askNow],
  );
  const focusHit = useCallback(
    (id: string) => {
      const index = hits.findIndex((h) => h.asset.id === id);
      if (index < 0) return;
      keyNav.current = true;
      setActive(index);
    },
    [hits, setActive],
  );

  // Keep the keyboard selection in view (hover never scrolls).
  useEffect(() => {
    if (!keyNav.current) return;
    keyNav.current = false;
    const id = hits[active]?.asset.id;
    if (id) document.getElementById(`ask-hit-${id}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, hits]);

  // A new question starts from the top, so results land in view.
  const runId = run?.id;
  useEffect(() => {
    const el = scrollRef.current;
    if (runId === undefined || !el || el.scrollTop === 0) return;
    el.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  }, [runId, reduce]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const dir = event.key === 'ArrowDown' ? 1 : -1;
      if (committed && hits.length) {
        event.preventDefault();
        keyNav.current = true;
        setActive(Math.max(0, Math.min(Math.min(hits.length, shownCount) - 1, active + dir)));
      } else if (!run && !normalizeQuery(query)) {
        event.preventDefault();
        setExampleActive((i) => (i < 0 ? (dir > 0 ? 0 : examples.length - 1) : (i + dir + examples.length) % examples.length));
      }
      return;
    }
    if (event.key !== 'Enter' || event.target !== inputRef.current) return;
    event.preventDefault();
    if (event.metaKey || event.ctrlKey) {
      if (stage === 4) report();
      return;
    }
    if (!normalizeQuery(query)) {
      if (exampleActive >= 0) ask(examples[exampleActive].query);
      return;
    }
    if (submit() === 'ready' && activeHit) openHit(activeHit.asset.id);
  };

  // ---- visual index states ---------------------------------------------------
  const previewIds = useMemo(
    () => (!run && exampleActive >= 0 ? new Set(examples[exampleActive]?.ids ?? []) : null),
    [run, exampleActive, examples],
  );
  const candidates = useMemo(() => (run ? candidatesOf(run) : null), [run]);

  const thumbStates = useMemo(() => {
    const out: Record<string, ThumbState> = {};
    for (const { id } of strip) {
      if (committed?.hitIds.has(id)) out[id] = 'lifted';
      else if (!run) out[id] = previewIds ? (previewIds.has(id) ? 'candidate' : 'dim') : 'idle';
      else if (stage === 1) out[id] = 'scan';
      else if (stage === 2) out[id] = !candidates || candidates.has(id) ? 'candidate' : 'dim';
      else out[id] = run.hitIds.has(id) ? 'hit' : 'faint';
    }
    return out;
  }, [strip, committed, run, stage, previewIds, candidates]);

  const stripSummary = useMemo(() => {
    const total = pool.length;
    if (!run) return previewIds ? `${previewIds.size} of ${total} match this example` : `${plural(total, 'field record')}`;
    if (stage === 1) return `reading ${plural(total, 'record')}`;
    if (stage === 2) return `${candidates ? candidates.size : total} of ${total} match a term`;
    if (stage === 3) return `${run.hitIds.size} of ${total} pass`;
    return `${run.hitIds.size} of ${total} in results`;
  }, [pool.length, run, stage, previewIds, candidates]);

  const onPreview = useCallback((i: number) => setExampleActive(i), []);
  const onHover = useCallback((i: number) => setActive(i), [setActive]);
  const understanding = run && stage >= 2 ? run : committed;

  return (
    <div className="flex h-full min-h-0 flex-col" onKeyDown={onKeyDown}>
      {/* ---- Ask ---------------------------------------------------------- */}
      <div className="relative flex h-16 shrink-0 items-center gap-3 border-b border-line px-4 sm:h-[68px] sm:px-5">
        <Search className={cn('h-[18px] w-[18px] shrink-0 transition-colors duration-200', running ? 'text-signal' : 'text-ink-2')} strokeWidth={2} />
        <input
          ref={inputRef}
          data-autofocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setExampleActive(-1);
          }}
          placeholder="Ask anything about your visual data…"
          aria-label="Ask VisualOps"
          role="combobox"
          aria-expanded={hits.length > 0}
          aria-controls={committed ? 'ask-results' : undefined}
          aria-autocomplete="list"
          aria-activedescendant={committed && activeHit ? `ask-hit-${activeHit.asset.id}` : undefined}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          className="h-full min-w-0 flex-1 bg-transparent text-[17px] tracking-[-0.012em] text-ink placeholder:text-ink-3 focus:outline-none sm:text-[21px]"
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            className="btn btn-ghost btn-sm btn-icon shrink-0"
            aria-label="Clear question"
          >
            <X className="h-4 w-4" />
          </button>
        )}
        <Kbd className="hidden shrink-0 sm:inline-flex">esc</Kbd>
        <button type="button" onClick={onClose} className="btn btn-ghost btn-sm shrink-0 sm:hidden">
          Close
        </button>

        {/* Run progress: the input's hairline fills stage by stage (transform only). */}
        {run && !reduce && (
          <motion.span
            key={run.id}
            aria-hidden
            className="absolute inset-x-0 -bottom-px h-px origin-left bg-signal"
            initial={{ scaleX: 0, opacity: 1 }}
            animate={{ scaleX: stage / 4, opacity: stage === 4 ? 0 : 1 }}
            transition={{
              scaleX: { duration: STAGE_MS / 1000, ease: 'linear' },
              opacity: { duration: 0.4, delay: stage === 4 ? 0.25 : 0 },
            }}
          />
        )}
      </div>

      <StatusLine
        stage={stage}
        run={run}
        composing={composing}
        pool={pool.length}
        photos={photos}
        videos={pool.length - photos}
        sites={sites.length}
      />
      <p className="sr-only" aria-live="polite">
        {stage === 4 && committed ? `${plural(committed.result.hits.length, 'result')} for ${committed.query}` : ''}
      </p>

      {/* ---- Evidence ------------------------------------------------------- */}
      <motion.div ref={scrollRef} layoutScroll className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <IndexStrip
          records={strip}
          total={pool.length}
          states={thumbStates}
          flight={flight}
          scope={scope}
          epoch={committed?.id ?? 0}
          sweepKey={stage === 1 && run && !reduce ? run.id : null}
          summary={stripSummary}
          onOpen={openHit}
          onFocusHit={focusHit}
        />

        {understanding && (
          <Understanding run={understanding} stage={stage} final={understanding === committed && stage === 4} still={reduce} />
        )}

        {committed ? (
          <div
            className={cn(
              'grid grid-cols-1 gap-x-6 px-2.5 pb-5 pt-2 transition-opacity duration-200 sm:px-3.5 lg:grid-cols-[minmax(0,1fr)_356px] lg:pr-5',
              running && 'opacity-55',
            )}
          >
            <div id="ask-results" role="listbox" aria-label="Results" className="min-w-0 space-y-0.5">
              {hits.length > 0 && (
                <div aria-hidden className="flex items-baseline justify-between gap-3 px-2 pb-1.5 pt-1">
                  <span className="label">Results</span>
                  <span className="hidden font-mono text-[10.5px] text-ink-3 sm:inline">Ranked by keyword matches · severity · newest</span>
                </div>
              )}
              {hits.length === 0 ? (
                <NoResults run={committed} pool={pool} sites={sites} now={now} onAsk={ask} />
              ) : (
                hits.slice(0, shownCount).map((hit, i) => {
                  const tileFlight = flight && i < FLIGHT_CAP && stripIds.has(hit.asset.id);
                  return (
                    <EvidenceTile
                      key={hit.asset.id}
                      hit={hit}
                      index={i}
                      active={i === active}
                      keywords={keywords}
                      now={now}
                      flight={tileFlight}
                      placeholder={tileFlight}
                      scope={scope}
                      entrance={!reduce && !tileFlight}
                      onHover={onHover}
                      onOpen={openHit}
                    />
                  );
                })
              )}
              {hits.length > shownCount && (
                <button
                  type="button"
                  onClick={() => setPage({ run: committed.id, count: shownCount + RESULT_PAGE })}
                  className="btn btn-ghost btn-sm mt-2 w-full"
                >
                  Show {Math.min(RESULT_PAGE, hits.length - shownCount)} more of {hits.length}
                </button>
              )}
            </div>
            {activeHit && (
              <aside aria-label="Selected evidence" className="hidden border-l border-line pl-5 lg:block">
                <div className="sticky top-3 pt-1">
                  <EvidencePreview
                    hit={activeHit}
                    still={reduce}
                    now={now}
                    onInspect={() => openHit(activeHit.asset.id)}
                    onStudio={() => studio(activeHit.asset.id)}
                  />
                </div>
              </aside>
            )}
          </div>
        ) : (
          <div className={cn('transition-opacity duration-200', run && 'pointer-events-none opacity-40')}>
            <AskIdle examples={examples} facets={facets} activeExample={exampleActive} onAsk={ask} onPreview={onPreview} />
          </div>
        )}
      </motion.div>

      {/* ---- Footer --------------------------------------------------------- */}
      <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-2.5 sm:px-5">
        <span className="num shrink-0 whitespace-nowrap font-mono text-[11px] text-ink-3">
          {committed ? (
            <>
              {hits.length} of {pool.length}
              <span className="hidden sm:inline"> {pool.length === 1 ? 'record' : 'records'}</span>
            </>
          ) : (
            plural(pool.length, 'field record')
          )}
        </span>
        {provenance && <span className="hidden text-[11px] text-ink-3 md:inline">{provenance}</span>}
        <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-ink-3 xl:flex">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          <span className="mr-2">select</span>
          <Kbd>↵</Kbd>
          <span className="mr-2">{committed ? 'inspect' : 'search'}</span>
          {committed && (
            <>
              <Kbd>{mod === '⌘' ? '⌘↵' : 'Ctrl ↵'}</Kbd>
              <span>report</span>
            </>
          )}
        </span>
        {committed && (
          <div className="ml-auto flex gap-2 xl:ml-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!activeHit}
              onClick={() => activeHit && studio(activeHit.asset.id)}
            >
              <Wand2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Open in Studio</span>
              <span className="sm:hidden">Studio</span>
            </button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={!hits.length || running} onClick={report}>
              <FileText className="h-3.5 w-3.5" />
              Report on these
              <span className="num font-mono text-[10.5px] text-ink-3">{hits.length}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

/**
 * Nothing matched. When filters emptied the set, name the one to relax and how many
 * records the question returns without it (each count is a real re-run of the query);
 * generic retry terms only when no single relaxation returns anything.
 */
function NoResults({
  run,
  pool,
  sites,
  now,
  onAsk,
}: {
  run: AskRun;
  pool: MediaAsset[];
  sites: string[];
  now: number;
  onAsk: (q: string) => void;
}) {
  const options = useMemo(() => relaxations(run.parsed, pool, { sites, now }), [run, pool, sites, now]);
  const unmatched = run.result.unmatchedKeywords;
  const onlyWords = run.filterCount === 0 && unmatched.length > 0;
  let heading: string;
  if (onlyWords) heading = `No record mentions ${unmatched.map((k) => `“${k}”`).join(' or ')}.`;
  else if (run.result.keywords.length) heading = 'No record matches every term.';
  else if (run.filterCount > 1) heading = `No record matches all ${run.filterCount} filters.`;
  else if (run.filterCount === 1) heading = 'No record matches this filter.';
  else heading = 'There are no field records to search yet.';

  return (
    <div className="px-2 py-8 sm:py-12">
      <p className="type-heading text-[18px] text-ink [overflow-wrap:anywhere]">{heading}</p>
      {options.length > 0 ? (
        <>
          <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-ink-3">
            Filters are combined, so each one narrows the set. Relaxing one of them returns records:
          </p>
          <ul className="mt-4 max-w-[600px] border-t border-line" aria-label="Relaxed questions">
            {options.map((option) => (
              <li key={option.key} className="border-b border-line">
                <RelaxationRow option={option} onAsk={onAsk} />
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="mt-2 max-w-[52ch] text-[13px] leading-relaxed text-ink-3">
            {onlyWords
              ? 'Keywords are matched against tags, titles, file names and sites — nothing is inferred. Try a site, a severity, or one of these:'
              : run.filterCount
                ? 'Filters are combined, so each one narrows the set, and relaxing any single one still returns nothing. Try fewer terms, a site name, a severity, or one of these:'
                : 'Try a site, a severity, or one of these:'}
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {RETRY_TERMS.map((term) => (
              <button key={term} type="button" onClick={() => onAsk(term)} className="chip transition-colors hover:border-ink-3 hover:text-ink">
                {term}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RelaxationLabel({ option }: { option: Relaxation }) {
  // "Widen to captured: past 7 days" / "Without captured: last week", worded like the filter chips.
  return (
    <>
      {option.kind === 'widen' ? 'Widen to ' : 'Without '}
      <span className="text-signal">{option.kind === 'widen' ? filterLabel(option.parsed, option.filter) : option.filterLabel}</span>
    </>
  );
}

function RelaxationRow({ option, onAsk }: { option: Relaxation; onAsk: (q: string) => void }) {
  const count = <span className="num shrink-0 font-mono text-[10.5px] text-ink-3">{plural(option.hits, 'record')}</span>;
  const { query } = option;
  if (!query) {
    // The filter comes from a word that is also a keyword ("bridge"), so no rewording drops it alone.
    return (
      <div className="flex min-w-0 items-center gap-4 px-1 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] leading-snug text-ink-2 [overflow-wrap:anywhere]">
            <RelaxationLabel option={option} />
          </span>
          <span className="mt-0.5 block text-[11.5px] text-ink-3">Set by a keyword — edit the question to drop it</span>
        </span>
        {count}
        <span aria-hidden className="w-3.5 shrink-0" />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onAsk(query)}
      className="group flex w-full min-w-0 items-center gap-4 px-1 py-3 text-left transition-colors duration-150 hover:bg-raised focus-visible:bg-raised"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] leading-snug text-ink [overflow-wrap:anywhere]">
          <RelaxationLabel option={option} />
        </span>
        <span className="mt-0.5 block truncate font-mono text-[11px] text-ink-3" title={query}>
          Ask “{query}”
        </span>
      </span>
      {count}
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-ink-3 transition-[transform,color] duration-200 group-hover:translate-x-0.5 group-hover:text-signal" />
    </button>
  );
}
