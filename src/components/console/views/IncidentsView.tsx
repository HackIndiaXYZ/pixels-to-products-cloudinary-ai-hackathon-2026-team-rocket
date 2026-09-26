'use client';

import { LayoutGroup } from 'framer-motion';
import { FileText } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { categorySeverityMatrix, findingRecords, severityCounts, sitesOf, statusCounts } from '@/lib/analytics';
import { useDeviceTier } from '@/components/motion/hooks';
import { useConsoleActions, useConsoleData } from '../store';
import { FilterBar } from '../incidents/FilterBar';
import { FindingList } from '../incidents/FindingList';
import { LeadFinding } from '../incidents/LeadFinding';
import { RiskMatrix, type MatrixPick } from '../incidents/RiskMatrix';
import {
  DEFAULT_FILTERS,
  filtersActive,
  inBaseScope,
  matchesStatus,
  pickLead,
  statusWiden,
  type IncidentFilters,
  type StatusFilter,
} from '../incidents/model';
import { ViewHeader } from './ViewHeader';

/** framer layout animations are reserved for short lists. */
const LAYOUT_LIMIT = 30;

/**
 * Incident intelligence: consequence first. The most severe open finding in
 * the current filters leads; everything else follows by severity with density
 * that falls as consequence falls; the risk matrix counts what is in scope.
 *
 * It opens on status 'open', the same set the Overview's "Open findings" and
 * the sidebar badge count. Memoised with narrow store hooks, so opening Ask or
 * the Inspector over it never re-renders the view.
 */
export const IncidentsView = memo(function IncidentsView() {
  const { assets, now } = useConsoleData();
  const { inspect, reportFor } = useConsoleActions();
  const tier = useDeviceTier();

  const all = useMemo(() => findingRecords(assets), [assets]);
  const sites = useMemo(() => sitesOf(assets), [assets]);
  const [filters, setFilters] = useState<IncidentFilters>(DEFAULT_FILTERS);
  const patch = useCallback((next: Partial<IncidentFilters>) => setFilters((prev) => ({ ...prev, ...next })), []);
  const reset = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  const { category, severities, site, media, status, window: dateWindow } = filters;
  // Site, media and date: the scope every count below starts from.
  const siteScope = useMemo(
    () => all.filter((r) => inBaseScope(r, { category: 'all', site, media, window: dateWindow }, now)),
    [all, now, site, media, dateWindow],
  );
  // The matrix never filters itself: it counts within every filter except its own axes (category, severity).
  const matrixBase = useMemo(() => siteScope.filter((r) => matchesStatus(r, status)), [siteScope, status]);
  // Everything except severity — the scope for the severity toggles.
  const base = useMemo(
    () => (category === 'all' ? matrixBase : matrixBase.filter((r) => r.finding.category === category)),
    [matrixBase, category],
  );
  const records = useMemo(
    () => (severities.length ? base.filter((r) => severities.includes(r.finding.severity)) : base),
    [base, severities],
  );
  // Everything except status — the figures beside each status choice.
  const byStatus = useMemo(
    () =>
      statusCounts(
        siteScope.filter(
          (r) =>
            (category === 'all' || r.finding.category === category) &&
            (severities.length === 0 || severities.includes(r.finding.severity)),
        ),
      ),
    [siteScope, category, severities],
  );
  const counts = useMemo(() => severityCounts(base), [base]);
  const matrix = useMemo(() => categorySeverityMatrix(matrixBase), [matrixBase]);
  const scaleMax = useMemo(() => Math.max(1, ...categorySeverityMatrix(all).map((c) => c.count)), [all]);

  const lead = useMemo(() => pickLead(records), [records]);
  const rest = useMemo(() => (lead ? records.filter((r) => r !== lead.record) : records), [records, lead]);
  const reportIds = useMemo(() => Array.from(new Set(records.map((r) => r.asset.id))), [records]);
  const leadCell = useMemo<MatrixPick | null>(
    () => (lead ? { category: lead.record.finding.category, severity: lead.record.finding.severity } : null),
    [lead],
  );

  const widen = useMemo(() => statusWiden(status, byStatus, records.length), [status, byStatus, records.length]);
  const showStatus = useCallback((next: StatusFilter) => patch({ status: next }), [patch]);
  const reportOne = useCallback((id: string) => reportFor([id], 'incident'), [reportFor]);
  const pickCell = useCallback(
    (cell: MatrixPick) =>
      setFilters((prev) => {
        const picked = prev.category === cell.category && prev.severities.length === 1 && prev.severities[0] === cell.severity;
        return picked
          ? { ...prev, category: 'all', severities: [] }
          : { ...prev, category: cell.category, severities: [cell.severity] };
      }),
    [],
  );

  const active = filtersActive(filters);

  return (
    <div className="space-y-5">
      <ViewHeader
        title="Incidents"
        subtitle="Every finding from field media, ranked by consequence — where it is, how severe, and whether it is resolved"
        actions={
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!records.length}
            onClick={() => reportFor(reportIds, 'incident')}
          >
            <FileText aria-hidden className="h-3.5 w-3.5" /> Report on these <span className="num">{records.length}</span>
          </button>
        }
      />

      <FilterBar
        filters={filters}
        onChange={patch}
        onReset={reset}
        counts={counts}
        statusCounts={byStatus}
        sites={sites}
        inView={records.length}
      />

      {/* One layout group: when the lead swaps, the rows below glide instead of jumping. */}
      <LayoutGroup>
        <LeadFinding
          lead={lead}
          assets={assets}
          now={now}
          inView={records.length}
          canReset={active}
          widen={widen}
          onInspect={inspect}
          onReport={reportOne}
          onReset={reset}
          onWiden={showStatus}
        />

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_356px]">
          <FindingList
            records={rest}
            now={now}
            hasLead={Boolean(lead)}
            animateLayout={tier === 'high' && records.length <= LAYOUT_LIMIT}
            onInspect={inspect}
          />
          <RiskMatrix
            cells={matrix}
            scaleMax={scaleMax}
            category={category}
            severities={severities}
            lead={leadCell}
            onPick={pickCell}
          />
        </div>
      </LayoutGroup>
    </div>
  );
});
