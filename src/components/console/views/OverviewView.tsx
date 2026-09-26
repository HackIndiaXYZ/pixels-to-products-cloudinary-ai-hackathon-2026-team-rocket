'use client';

import { FileText, Search } from 'lucide-react';
import { useMemo } from 'react';
import { captureTimeline, overviewSummary } from '@/lib/analytics';
import { formatDateTime } from '@/lib/format';
import { useConsoleActions, useConsoleData } from '../store';
import { ActivityStream } from '../overview/ActivityStream';
import { CaptureTimeline } from '../overview/CaptureTimeline';
import { DeliveryLatency } from '../overview/DeliveryLatency';
import { KeyNumbers } from '../overview/KeyNumbers';
import { LeadIncident } from '../overview/LeadIncident';
import { RecentEvidence } from '../overview/RecentEvidence';
import { SiteProgress } from '../overview/SiteProgress';

/**
 * Command center. Reads top to bottom as a decision:
 * the one finding to act on, the state of the estate, how the week and each
 * site are trending, what Cloudinary is doing right now, and the latest evidence.
 *
 * The headline, summary and counts come from overviewSummary(), the helper the
 * landing page's preview uses too, so the two can never disagree.
 */
export function OverviewView() {
  const { assets, now } = useConsoleData();
  const { setPaletteOpen, navigate } = useConsoleActions();

  const o = useMemo(() => overviewSummary(assets), [assets]);
  const { field } = o;
  const timeline = useMemo(() => captureTimeline(field, 7, now), [field, now]);
  const recent = useMemo(
    () => [...field].sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt)).slice(0, 6),
    [field],
  );

  return (
    <div className="space-y-5 lg:space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <p className="label">Command center · as of {formatDateTime(new Date(now).toISOString())}</p>
          {/* tabIndex -1: the console moves focus here after a view switch (not a tab stop). */}
          <h1 tabIndex={-1} className="type-heading mt-2.5 text-balance text-[26px] text-ink outline-none sm:text-[30px]">
            <span className="sr-only">Overview. </span>
            {o.headline}
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-3">{o.summary}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPaletteOpen(true)} data-cursor="SEARCH">
            <Search className="h-3.5 w-3.5" /> Ask VisualOps
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('reports')}>
            <FileText className="h-3.5 w-3.5" /> Build report
          </button>
        </div>
      </header>

      {/* The panels are memoised and default to the console's stable actions, so no callbacks are passed. */}
      <LeadIncident lead={o.lead} queue={o.queue} openTotal={o.open.length} now={now} />

      <KeyNumbers
        field={field}
        openCounts={o.openBySeverity}
        openTotal={o.open.length}
        monitoring={o.counts.monitoring}
        resolved={o.counts.resolved}
        sites={o.siteCount}
        riskiest={o.riskiest}
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Operations analytics" className="panel min-w-0 overflow-hidden">
          <div className="grid divide-y divide-line md:grid-cols-2 md:divide-x md:divide-y-0">
            <CaptureTimeline days={timeline} totalCaptures={field.length} />
            <SiteProgress records={o.records} />
          </div>
          <div className="border-t border-line">
            <DeliveryLatency field={field} />
          </div>
        </section>
        <ActivityStream assets={assets} className="xl:relative" />
      </div>

      <RecentEvidence assets={recent} now={now} />
    </div>
  );
}
