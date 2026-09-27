'use client';

import { Check } from 'lucide-react';
import { Fragment } from 'react';
import { cn } from '@/components/ui/cn';
import { relatedCount, type AskRun, type AskStage } from './engine';

const STAGES = [
  { n: '01', label: 'Searching visual index', short: 'Index' },
  { n: '02', label: 'Matching metadata', short: 'Metadata' },
  { n: '03', label: 'Filtering evidence', short: 'Filtered' },
  { n: '04', label: 'Results', short: 'Results' },
] as const;

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function metadataDetail(run: AskRun): string {
  const parts: string[] = [];
  if (run.filterIds) parts.push(`${plural(run.filterCount, 'filter')} → ${run.filterIds.size}`);
  if (run.keywordIds) {
    // Keywords are searched with their related terms; the count says so instead of implying literal matches.
    const related = relatedCount(run);
    parts.push(`${plural(run.result.keywords.length, 'keyword')}${related ? ` (+${related} related)` : ''} → ${run.keywordIds.size}`);
  }
  return parts.length ? parts.join(' · ') : 'no terms';
}

function formatCompute(ms: number): string {
  if (ms < 0.1) return '<0.1 ms';
  return ms < 10 ? `${ms.toFixed(1)} ms` : `${Math.round(ms)} ms`;
}

/**
 * One mono line under the input that narrates the run. Each stage appears only
 * when it is reached, with the count that stage really produced.
 */
export function StatusLine({
  stage,
  run,
  composing,
  pool,
  photos,
  videos,
  sites,
}: {
  stage: AskStage;
  run: AskRun | null;
  composing: boolean;
  pool: number;
  photos: number;
  videos: number;
  sites: number;
}) {
  if (!run) {
    return (
      <div className="flex h-9 items-center gap-3 overflow-hidden whitespace-nowrap border-b border-line px-4 font-mono text-[10.5px] uppercase tracking-[0.08em] sm:px-5">
        <span className="flex items-center gap-2 text-ink-2">
          <span aria-hidden className="h-1.5 w-1.5 rounded-[1px] bg-signal" />
          {composing ? 'Listening — pause or press ↵' : 'Visual index ready'}
        </span>
        <span className="num hidden text-ink-3 sm:inline">
          {plural(pool, 'record')} · {photos} photos · {videos} videos · {plural(sites, 'site')}
        </span>
        <span className="ml-auto hidden text-ink-3 md:inline">Parsed in your browser · no language model</span>
      </div>
    );
  }

  const total = run.result.hits.length;
  const details = (i: number, current: boolean) =>
    [
      current ? `${plural(pool, 'record')} indexed` : plural(pool, 'record'),
      metadataDetail(run),
      `${pool} → ${total}`,
      `${total} of ${pool}`,
    ][i];

  return (
    <div
      className="flex h-9 items-center gap-2.5 overflow-hidden whitespace-nowrap border-b border-line px-4 font-mono text-[10.5px] uppercase tracking-[0.08em] sm:px-5"
      aria-hidden
    >
      {STAGES.map((s, i) => {
        const step = (i + 1) as AskStage;
        const done = stage > step || (stage === 4 && step === 4);
        const current = stage === step && step < 4;
        const reached = stage >= step;
        const isFinal = step === 4;
        return (
          <Fragment key={s.n}>
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  'hidden h-px w-3 shrink-0 bg-line-strong transition-colors duration-200 sm:block',
                  reached && 'bg-[color-mix(in_oklab,var(--color-signal)_45%,var(--color-line-strong))]',
                )}
              />
            )}
            <span
              className={cn(
                'flex shrink-0 items-center gap-1.5 transition-colors duration-200',
                !reached && 'text-ink-3/55',
                current && 'text-signal',
                done && !isFinal && 'text-ink-3',
                isFinal && stage === 4 && (total ? 'text-ink' : 'text-warn'),
                // Phones show only the step in focus.
                !current && !(stage === 4 && isFinal) && 'hidden sm:flex',
              )}
            >
              {done && !isFinal ? (
                <Check className="h-3 w-3 text-signal" strokeWidth={2.4} />
              ) : (
                <span className={cn('num', current ? 'text-signal' : 'text-ink-3/70')}>{s.n}</span>
              )}
              <span>{current ? s.label : s.short}</span>
              {reached && (
                <span className={cn('num', current || isFinal ? 'text-ink' : 'text-ink-2', done && !isFinal && 'hidden lg:inline')}>
                  {details(i, current)}
                </span>
              )}
            </span>
          </Fragment>
        );
      })}
      {stage === 4 && (
        <span className="num ml-auto hidden pl-3 text-ink-3 lg:inline" title="Measured time to parse the question and filter the records">
          computed in {formatCompute(run.ms)}
        </span>
      )}
    </div>
  );
}
