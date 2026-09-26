'use client';

import { motion } from 'framer-motion';
import { ArrowRight, CornerDownLeft, FileText, Film, Search, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CATEGORY_LABEL, fieldAssets, sitesOf } from '@/lib/analytics';
import { thumbUrl } from '@/lib/cloudinary/media';
import { relativeTime } from '@/lib/format';
import { EXAMPLE_QUERIES, parseQuery, runQuery } from '@/lib/search/query';
import { CloudImage } from '@/components/media/CloudImage';
import { Kbd, SeverityBadge } from '@/components/ui/badges';
import { Dialog } from '@/components/ui/Dialog';
import { cn } from '@/components/ui/cn';
import { useConsole } from './store';

export function AskPalette() {
  const { paletteOpen, setPaletteOpen } = useConsole();
  return (
    <Dialog
      open={paletteOpen}
      onClose={() => setPaletteOpen(false)}
      title="Ask VisualOps"
      hideHeader
      position="top"
      className="max-w-[720px]"
    >
      <PaletteBody />
    </Dialog>
  );
}

function PaletteBody() {
  const { assets, now, inspect, setPaletteOpen, reportFor, openInStudio } = useConsole();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const pool = useMemo(() => fieldAssets(assets), [assets]);
  const sites = useMemo(() => sitesOf(assets), [assets]);

  const parsed = useMemo(() => (query.trim() ? parseQuery(query, sites, now) : null), [query, sites, now]);
  const result = useMemo(() => (parsed ? runQuery(parsed, pool) : null), [parsed, pool]);
  const hits = result?.hits ?? [];

  const close = () => setPaletteOpen(false);
  const open = (id: string) => {
    close();
    inspect(id);
  };

  const chips: string[] = [];
  if (parsed) {
    parsed.severities.forEach((s) => chips.push(`severity: ${s}`));
    parsed.categories.forEach((c) => chips.push(`category: ${CATEGORY_LABEL[c].toLowerCase()}`));
    parsed.sites.forEach((s) => chips.push(`site: ${s}`));
    parsed.mediaTypes.forEach((m) => chips.push(`media: ${m === 'image' ? 'photos' : 'videos'}`));
    parsed.statuses.forEach((s) => chips.push(`status: ${s}`));
    if (parsed.window) chips.push(`captured: ${parsed.window.label}`);
  }
  const keywordChips = result?.keywords.filter((k) => !result.unmatchedKeywords.includes(k)) ?? [];

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter' && hits[active]) {
      event.preventDefault();
      open(hits[active].asset.id);
    }
  };

  return (
    <div className="flex min-h-0 flex-col" onKeyDown={onKeyDown}>
      <div className="flex items-center gap-3 border-b border-line px-4">
        <Search className="h-4 w-4 shrink-0 text-signal" />
        <input
          data-autofocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="Ask anything about your visual data…"
          aria-label="Ask VisualOps"
          className="h-14 w-full bg-transparent text-[15px] text-ink placeholder:text-ink-3 focus:outline-none"
        />
        <Kbd>esc</Kbd>
      </div>

      {!parsed ? (
        <div className="space-y-4 p-4">
          <div>
            <div className="label mb-2">Try</div>
            <ul className="space-y-1">
              {EXAMPLE_QUERIES.map((q) => (
                <li key={q}>
                  <button
                    type="button"
                    onClick={() => setQuery(q)}
                    className="flex w-full items-center justify-between rounded-[8px] px-3 py-2 text-left text-[13.5px] text-ink-2 hover:bg-raised hover:text-ink"
                  >
                    “{q}”
                    <ArrowRight className="h-3.5 w-3.5 text-ink-3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[12px] leading-relaxed text-ink-3">
            VisualOps turns your question into explicit filters — severity, category, site, time, media type, status — plus keywords
            matched against each record’s tags and findings. The interpretation is always shown; nothing is guessed silently.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-4 py-2.5">
            <span className="label mr-1">Understood as</span>
            {chips.length === 0 && keywordChips.length === 0 && result?.unmatchedKeywords.length === 0 && (
              <span className="text-[12px] text-ink-3">everything</span>
            )}
            {chips.map((c) => (
              <span key={c} className="chip border-[color-mix(in_oklab,var(--color-signal)_35%,transparent)] text-signal">
                {c}
              </span>
            ))}
            {keywordChips.map((k) => (
              <span key={k} className="chip">
                “{k}”
              </span>
            ))}
            {result?.unmatchedKeywords.map((k) => (
              <span key={k} className="chip line-through opacity-60" title="No record mentions this">
                “{k}”
              </span>
            ))}
          </div>

          {result?.relaxed && (
            <p className="border-b border-line px-4 py-2 text-[12px] text-ink-3">
              No record mentions {result.unmatchedKeywords.map((k) => `“${k}”`).join(', ')} — showing the {hits.length} records that match the other filters.
            </p>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto p-2" role="listbox" aria-label="Results">
            {hits.length === 0 ? (
              <div className="px-3 py-10 text-center text-[13px] text-ink-3">
                No media matches. Try a site name, a severity, or words like “crack”, “rebar”, “wet floor”.
              </div>
            ) : (
              <>
                {hits.map((hit, i) => {
                  const { asset } = hit;
                  return (
                    <motion.button
                      key={asset.id}
                      initial={{ y: 4 }}
                      animate={{ y: 0 }}
                      transition={{ duration: 0.15, delay: Math.min(i * 0.02, 0.2) }}
                      type="button"
                      role="option"
                      aria-selected={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => open(asset.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left',
                        i === active ? 'bg-raised' : 'hover:bg-raised/60',
                      )}
                    >
                      <span className="relative h-12 w-[76px] shrink-0 overflow-hidden rounded-[6px] border border-line bg-raised">
                        <CloudImage src={thumbUrl(asset, 152, 96)} alt="" className="h-full w-full object-cover" />
                        {asset.resourceType === 'video' && <Film className="absolute bottom-1 right-1 h-3 w-3 text-white drop-shadow" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          {asset.finding && <SeverityBadge severity={asset.finding.severity} />}
                          <span className="truncate font-mono text-[11px] text-ink-3">{asset.fileName}</span>
                        </span>
                        <span className="mt-0.5 block truncate text-[13.5px] font-medium">{asset.finding?.title ?? asset.title}</span>
                        <span className="block truncate text-[12px] text-ink-3">
                          {asset.site} · {relativeTime(asset.capturedAt, now)}
                          {hit.matched.length > 0 && <> · matched {hit.matched.map((m) => `“${m}”`).join(', ')}</>}
                        </span>
                      </span>
                      {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-ink-3" />}
                    </motion.button>
                  );
                })}
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
            <span className="num font-mono text-[11px] text-ink-3">
              {hits.length} of {pool.length} records
            </span>
            <div className="flex gap-2">
              {hits[active] && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    close();
                    openInStudio(hits[active].asset.id);
                  }}
                >
                  <Wand2 className="h-3.5 w-3.5" /> Studio
                </button>
              )}
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!hits.length}
                onClick={() => {
                  close();
                  reportFor(hits.map((h) => h.asset.id));
                }}
              >
                <FileText className="h-3.5 w-3.5" /> Report on these
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
