'use client';

import { motion } from 'framer-motion';
import { memo, useMemo, type CSSProperties } from 'react';
import type { FindingStatus } from '@/lib/types';
import { SEVERITIES, SEVERITY_RANK, STATUS_LABEL, siteSummaries, type FindingRecord } from '@/lib/analytics';
import { useReducedMotionPref } from '@/components/motion/hooks';
import { SEVERITY_COLOR } from '@/components/ui/badges';
import { useConsoleActions } from '../store';
import { EASE, PanelTitle, Swatch } from './shared';

const STATUS_ORDER: Record<FindingStatus, number> = { open: 0, monitoring: 1, resolved: 2 };
const RESOLVED = 'color-mix(in oklab, var(--color-ok) 52%, var(--color-surface))';

function unitStyle({ finding }: FindingRecord): CSSProperties {
  const color = SEVERITY_COLOR[finding.severity];
  if (finding.status === 'open') return { backgroundColor: color };
  if (finding.status === 'monitoring') {
    return { boxShadow: `inset 0 0 0 1.5px ${color}`, backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` };
  }
  return { backgroundColor: RESOLVED };
}

/**
 * Inspection progress per site as a unit chart: one block per structured
 * record, open first (coloured by severity), then monitoring, then resolved.
 * Each block opens its evidence. Counts use the shared definitions in
 * lib/analytics: "open" is status open, "closed" is status resolved.
 */
export const SiteProgress = memo(function SiteProgress({
  records,
  onInspect,
}: {
  records: FindingRecord[];
  /** Optional: defaults to the console's stable `inspect` action (keeps the memo effective). */
  onInspect?: (assetId: string) => void;
}) {
  const reduce = useReducedMotionPref();
  const actions = useConsoleActions();
  const inspect = onInspect ?? actions.inspect;
  const sites = useMemo(
    () =>
      siteSummaries(records).map((summary) => ({
        site: summary.site,
        open: summary.open,
        closed: summary.resolved,
        units: records
          .filter((r) => r.asset.site === summary.site)
          .sort(
            (a, b) =>
              STATUS_ORDER[a.finding.status] - STATUS_ORDER[b.finding.status] ||
              SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity],
          ),
      })),
    [records],
  );
  const max = Math.max(1, ...sites.map((s) => s.units.length));
  const closedAll = sites.reduce((n, s) => n + s.closed, 0);

  return (
    <div className="flex min-w-0 flex-col p-4 sm:p-5">
      <PanelTitle
        title="Inspection progress by site"
        meta={
          <>
            {closedAll}/{records.length} closed
          </>
        }
      />
      <p className="mt-1 h-4 truncate font-mono text-[11px] text-ink-3">One block per record · ordered by risk</p>

      <ul className="mt-4 space-y-3">
        {sites.map((s, i) => (
          <li key={s.site} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[12.5px] text-ink">{s.site}</span>
              <span className="num shrink-0 font-mono text-[10.5px] text-ink-3">
                {s.open} open · {s.closed}/{s.units.length} closed
              </span>
            </div>
            <motion.div
              className="mt-1.5 flex h-3 gap-[2px]"
              style={{ width: `${(s.units.length / max) * 100}%`, originX: 0 }}
              initial={reduce ? false : { scaleX: 0 }}
              whileInView={{ scaleX: 1 }}
              viewport={{ once: true, margin: '0px 0px -8% 0px' }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.12 + i * 0.06 }}
            >
              {s.units.map((u) => (
                <button
                  key={u.finding.id}
                  type="button"
                  onClick={() => inspect(u.asset.id)}
                  title={`${u.finding.id} · ${u.finding.severity} · ${STATUS_LABEL[u.finding.status]} — ${u.finding.title}`}
                  aria-label={`${u.finding.id}, ${u.finding.severity}, ${STATUS_LABEL[u.finding.status]}: ${u.finding.title}`}
                  className="h-full min-w-[6px] flex-1 rounded-[2px] transition-opacity duration-150 hover:opacity-75"
                  style={unitStyle(u)}
                />
              ))}
            </motion.div>
          </li>
        ))}
      </ul>

      <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-4 text-[11.5px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="flex gap-[2px]">
            {SEVERITIES.map((s) => (
              <Swatch key={s} color={SEVERITY_COLOR[s]} className="w-1.5" />
            ))}
          </span>
          Open, by severity
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch color="var(--color-ink-2)" hollow />
          Monitoring
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch color={RESOLVED} />
          Resolved
        </span>
      </div>
    </div>
  );
});
