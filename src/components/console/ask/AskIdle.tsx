'use client';

import { ArrowRight } from 'lucide-react';
import { SeverityDot } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import type { Facet } from './engine';

export interface ExamplePreview {
  query: string;
  ids: string[];
}

function records(n: number) {
  return `${n} record${n === 1 ? '' : 's'}`;
}

/**
 * The empty state: example questions (each with the number of records it really
 * returns, previewed on the index strip while hovered) and browse-by facets.
 */
export function AskIdle({
  examples,
  facets,
  activeExample,
  onAsk,
  onPreview,
}: {
  examples: ExamplePreview[];
  facets: { severity: Facet[]; sites: Facet[]; media: Facet[] };
  activeExample: number;
  onAsk: (query: string) => void;
  onPreview: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-8 gap-y-6 px-4 pb-6 pt-2 sm:px-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section aria-label="Example questions">
        <div className="label mb-1.5">Try asking</div>
        <ul className="border-t border-line" onPointerLeave={() => onPreview(-1)}>
          {examples.map((ex, i) => {
            const active = i === activeExample;
            return (
              <li key={ex.query} className="border-b border-line">
                <button
                  type="button"
                  onClick={() => onAsk(ex.query)}
                  onPointerEnter={() => onPreview(i)}
                  onFocus={() => onPreview(i)}
                  className={cn(
                    'group flex w-full items-center gap-4 px-1 py-3 text-left transition-colors duration-150',
                    active ? 'text-ink' : 'text-ink-2',
                  )}
                >
                  <span className={cn('num w-5 shrink-0 font-mono text-[10.5px]', active ? 'text-signal' : 'text-ink-3')}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] leading-snug tracking-[-0.01em]">“{ex.query}”</span>
                  <span className="num shrink-0 font-mono text-[10.5px] text-ink-3">{records(ex.ids.length)}</span>
                  <ArrowRight
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 transition-[transform,color] duration-200',
                      active ? 'translate-x-0.5 text-signal' : 'text-ink-3',
                    )}
                  />
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 max-w-[52ch] text-[12.5px] leading-relaxed text-ink-3">
          Questions become explicit filters — severity, category, site, time, media type, status — plus keywords matched
          against each record’s tags, titles and file names; some keywords also search related terms, which are listed.
          Parsing runs in your browser, with no language model. The interpretation is always shown: words that match
          nothing are struck through rather than dropped, and negation (“without”, “no”) is flagged, not applied.
        </p>
      </section>

      <section aria-label="Browse the index" className="space-y-5">
        <FacetGroup label="Severity">
          <div className="grid grid-cols-2 gap-1.5">
            {facets.severity.map((f) => (
              <FacetButton key={f.key} facet={f} onAsk={onAsk}>
                {f.severity && <SeverityDot severity={f.severity} />}
                <span className="capitalize">{f.label}</span>
              </FacetButton>
            ))}
          </div>
        </FacetGroup>
        <FacetGroup label="Sites">
          <div className="grid gap-1.5">
            {facets.sites.map((f) => (
              <FacetButton key={f.key} facet={f} onAsk={onAsk}>
                <span className="truncate">{f.label}</span>
              </FacetButton>
            ))}
          </div>
        </FacetGroup>
        <FacetGroup label="Media">
          <div className="grid grid-cols-2 gap-1.5">
            {facets.media.map((f) => (
              <FacetButton key={f.key} facet={f} onAsk={onAsk}>
                {f.label}
              </FacetButton>
            ))}
          </div>
        </FacetGroup>
      </section>
    </div>
  );
}

function FacetGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label mb-2">{label}</div>
      {children}
    </div>
  );
}

function FacetButton({ facet, onAsk, children }: { facet: Facet; onAsk: (q: string) => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onAsk(facet.query)}
      disabled={facet.count === 0}
      title={`Ask “${facet.query}”`}
      className="flex h-8 min-w-0 items-center gap-2 rounded-[6px] border border-line px-2.5 text-left text-[12.5px] text-ink-2 transition-colors duration-150 enabled:hover:border-line-strong enabled:hover:bg-raised enabled:hover:text-ink disabled:opacity-40"
    >
      {children}
      <span className="num ml-auto shrink-0 font-mono text-[10.5px] text-ink-3">{facet.count}</span>
    </button>
  );
}
