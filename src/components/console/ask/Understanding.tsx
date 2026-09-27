'use client';

import { motion } from 'framer-motion';
import { Info } from 'lucide-react';
import { useMemo } from 'react';
import { pluralize } from '@/lib/format';
import { cn } from '@/components/ui/cn';
import { ProvenanceBadge } from '@/components/ui/Provenance';
import { relatedTerms } from '@/lib/search/query';
import { describeReach, expansionsOf, fieldsLabel, interpret, negationNotice, type AskRun, type AskStage } from './engine';
import { EASE } from './IndexStrip';

/**
 * "Understood as": the explicit interpretation of the question — filters, keywords (with the
 * related terms searched), and which keywords reached records only through Cloudinary's AI.
 */
export function Understanding({ run, stage, final, still }: { run: AskRun; stage: AskStage; final: boolean; still: boolean }) {
  const chips = useMemo(() => interpret(run), [run]);
  const expansions = useMemo(() => expansionsOf(run), [run]);
  const negation = useMemo(() => negationNotice(run), [run]);
  const aiReach = useMemo(
    () =>
      run.result.keywords
        .filter((k) => run.keywordAi[k] && !run.result.unmatchedKeywords.includes(k))
        .map((k) => ({ keyword: k, ...run.keywordAi[k] })),
    [run],
  );
  const { result } = run;
  return (
    <div className="border-t border-line px-4 py-2.5 sm:px-5">
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <span className="label mr-1">Understood as</span>
        {chips.length === 0 ? (
          <motion.span
            key={`none-${run.id}`}
            className="text-[12px] text-ink-3"
            initial={still ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            everything — no filters or keywords recognised
          </motion.span>
        ) : (
          chips.map((chip, i) => (
            <motion.span
              key={`${run.id}-${chip.key}`}
              initial={still ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: EASE, delay: Math.min(i, 8) * 0.03 }}
              title={chip.note ? `${chip.label} — ${chip.note}` : chip.label}
              className={cn(
                'chip max-w-full',
                chip.tone === 'filter' && 'border-[color-mix(in_oklab,var(--color-signal)_38%,transparent)] bg-transparent text-signal',
                chip.tone === 'unmatched' && 'text-ink-3 line-through decoration-ink-3 opacity-70',
              )}
            >
              <span className="min-w-0 truncate">{chip.label}</span>
              {chip.related && (
                <>
                  <span aria-hidden className="num shrink-0 text-ink-3">
                    +{chip.related.length}
                  </span>
                  <span className="sr-only">and {pluralize(chip.related.length, 'related term')}</span>
                </>
              )}
              {chip.ai !== undefined && (
                <>
                  <span aria-hidden className="num shrink-0 font-mono text-[9.5px] uppercase tracking-[0.06em] text-signal/80">
                    ai {chip.ai}
                  </span>
                  <span className="sr-only">, {pluralize(chip.ai, 'record')} matched only through Cloudinary AI</span>
                </>
              )}
            </motion.span>
          ))
        )}
      </div>
      {expansions.length > 0 && (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3 [overflow-wrap:anywhere]">
          <span className="text-ink-2">Related terms also searched</span>
          {expansions.map(({ keyword, related }) => (
            <span key={keyword}>
              {' · '}
              <span className="text-ink-2">“{keyword}”</span> → {related.join(', ')}
            </span>
          ))}
        </p>
      )}
      {aiReach.length > 0 && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] leading-relaxed text-ink-3">
          <ProvenanceBadge kind="ai" detail="Cloudinary" />
          <span className="min-w-0 [overflow-wrap:anywhere]">
            {aiReach.map(({ keyword, records, fields }, i) => (
              <span key={keyword}>
                {i > 0 && ' · '}
                <span className="text-ink-2">“{keyword}”</span> reaches {pluralize(records, 'record')} only through {fieldsLabel(fields)}
              </span>
            ))}
            <span> — not in the human-classified record.</span>
          </span>
        </p>
      )}
      {negation && (
        <p className="mt-2 flex items-start gap-2 text-[12px] leading-relaxed text-ink-2">
          <Info className="mt-[2px] h-3.5 w-3.5 shrink-0 text-warn" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{negation}</span>
        </p>
      )}
      {final && result.relaxed && result.hits.length > 0 && stage === 4 && <RelaxedNotice run={run} />}
    </div>
  );
}

/** Keywords matched nothing inside the filters: say so, and say what is shown instead. */
function RelaxedNotice({ run }: { run: AskRun }) {
  const { result, keywordReach } = run;
  const several = result.unmatchedKeywords.length > 1;
  const words = result.unmatchedKeywords.map((k) => `“${k}”`).join(', ');
  const related = result.unmatchedKeywords.some((k) => relatedTerms(k).length) ? (several ? ' or their related terms' : ' or its related terms') : '';
  const elsewhere = result.unmatchedKeywords.filter((k) => keywordReach[k] > 0);
  const records = pluralize(result.hits.length, 'record');
  return (
    <p className="mt-2 flex items-start gap-2 text-[12px] leading-relaxed text-ink-2">
      <Info className="mt-[2px] h-3.5 w-3.5 shrink-0 text-warn" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {elsewhere.length ? (
          <>
            None of the {records} that match the filters mention {words}
            {related} — showing them without {several ? 'those words' : 'that word'}.{' '}
            <span className="text-ink-3">{elsewhere.map((k) => describeReach(run, k)).join('; ')} outside these filters.</span>
          </>
        ) : (
          <>
            No record mentions {words}
            {related} — showing the {records} that match the other filters.
          </>
        )}
      </span>
    </p>
  );
}
