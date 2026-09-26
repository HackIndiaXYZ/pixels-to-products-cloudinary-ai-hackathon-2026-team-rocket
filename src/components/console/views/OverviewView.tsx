'use client';

import { ArrowRight, FileText, Search } from 'lucide-react';
import type { MediaAsset } from '@/lib/types';
import {
  SEVERITIES,
  captureTimeline,
  fieldAssets,
  findingRecords,
  severityCounts,
  siteSummaries,
} from '@/lib/analytics';
import { thumbUrl } from '@/lib/cloudinary/media';
import { formatBytes, relativeTime } from '@/lib/format';
import { CloudImage } from '@/components/media/CloudImage';
import { SEVERITY_COLOR, SeverityBadge, SeverityDot, StatusBadge } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { useConsole } from '../store';
import { useDeliveryTotals, useInsights } from '../hooks';
import { ViewHeader } from './ViewHeader';

export function OverviewView() {
  const { assets, now, inspect, setPaletteOpen, navigate } = useConsole();
  const field = fieldAssets(assets);
  const records = findingRecords(assets);
  const open = records.filter((r) => r.finding.status !== 'resolved');
  const openCounts = severityCounts(open);
  const sites = siteSummaries(records);
  const totals = useDeliveryTotals(field);
  const insights = useInsights(field);
  const facesIn = Object.values(insights).filter((i) => i && i !== 'error' && i.faces.length > 0).length;
  const faceCount = Object.values(insights).reduce((n, i) => n + (i && i !== 'error' ? i.faces.length : 0), 0);
  const signalsReady = Object.values(insights).filter((i) => i && i !== 'error').length;
  const timeline = captureTimeline(field, 7, now);
  const maxDay = Math.max(1, ...timeline.map((d) => d.count));
  const photos = field.filter((a) => a.resourceType === 'image').length;
  const videos = field.length - photos;
  const attention = open.slice(0, 6);

  const original = totals.imageOriginal + totals.videoOriginal;
  const delivered = totals.imageDelivered + totals.videoDelivered;
  const saved = original ? 1 - delivered / original : 0;

  return (
    <div className="space-y-6">
      <ViewHeader
        title="Overview"
        subtitle={`What your field media says right now · ${field.length} captures across ${sites.length} sites`}
        actions={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPaletteOpen(true)}>
              <Search className="h-3.5 w-3.5" /> Ask VisualOps
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate('reports')}>
              <FileText className="h-3.5 w-3.5" /> Build report
            </button>
          </>
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Field media" value={String(field.length)} detail={`${photos} photos · ${videos} videos`} onClick={() => navigate('library')} />
        <Kpi
          label="Open findings"
          value={String(open.length)}
          onClick={() => navigate('incidents')}
          detail={
            <div className="mt-1 space-y-1.5">
              <div className="flex h-1.5 overflow-hidden rounded-full bg-raised">
                {SEVERITIES.map((s) =>
                  openCounts[s] ? (
                    <span key={s} style={{ width: `${(openCounts[s] / open.length) * 100}%`, backgroundColor: SEVERITY_COLOR[s] }} />
                  ) : null,
                )}
              </div>
              <div className="flex flex-wrap gap-x-2.5 font-mono text-[10.5px] text-ink-3">
                {SEVERITIES.map((s) => (
                  <span key={s} className="flex items-center gap-1">
                    <SeverityDot severity={s} />
                    {openCounts[s]} {s}
                  </span>
                ))}
              </div>
            </div>
          }
        />
        <Kpi
          label="Sites reporting"
          value={String(sites.length)}
          detail={sites[0]?.worst ? `Highest risk: ${sites[0].site}` : 'No open risk'}
        />
        <Kpi
          label="Delivered by Cloudinary"
          value={totals.measured ? `−${Math.round(saved * 100)}%` : '…'}
          accent
          detail={
            totals.measured
              ? `${formatBytes(original)} of originals → ${formatBytes(delivered)} served · measured ${totals.measured}/${totals.total}`
              : `Measuring ${totals.total} renditions…`
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Needs attention */}
        <section className="panel">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="text-[13.5px] font-semibold">Needs attention</h2>
            <button type="button" onClick={() => navigate('incidents')} className="flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
              All incidents <ArrowRight className="h-3 w-3" />
            </button>
          </header>
          <ul className="divide-y divide-line">
            {attention.map(({ finding, asset }) => (
              <li key={finding.id}>
                <button
                  type="button"
                  onClick={() => inspect(asset.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
                >
                  <Thumb asset={asset} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-ink-3">{finding.id}</span>
                      <SeverityBadge severity={finding.severity} />
                    </div>
                    <div className="mt-1 truncate text-[13.5px] font-medium">{finding.title}</div>
                    <div className="truncate text-[12px] text-ink-3">
                      {asset.site}
                      {asset.zone ? ` · ${asset.zone}` : ''} · {relativeTime(asset.capturedAt, now)}
                    </div>
                  </div>
                  <StatusBadge status={finding.status} className="hidden sm:inline-flex" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-4">
          {/* Sites */}
          <section className="panel">
            <header className="border-b border-line px-4 py-3">
              <h2 className="text-[13.5px] font-semibold">Risk by site</h2>
            </header>
            <ul className="divide-y divide-line">
              {sites.map((s) => (
                <li key={s.site} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="h-6 w-1 rounded-full" style={{ backgroundColor: s.worst ? SEVERITY_COLOR[s.worst] : 'var(--color-line-strong)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{s.site}</div>
                    <div className="font-mono text-[11px] text-ink-3">
                      {s.open} open · {s.total} records
                    </div>
                  </div>
                  <div className="flex gap-1">
                    {SEVERITIES.map((sev) =>
                      s.bySeverity[sev] ? (
                        <span
                          key={sev}
                          className="num rounded-[5px] px-1.5 py-0.5 font-mono text-[10.5px]"
                          style={{ color: SEVERITY_COLOR[sev], backgroundColor: `color-mix(in oklab, ${SEVERITY_COLOR[sev]} 12%, transparent)` }}
                        >
                          {s.bySeverity[sev]}
                        </span>
                      ) : null,
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* Activity */}
          <section className="panel px-4 py-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[13.5px] font-semibold">Captures · last 7 days</h2>
              <span className="font-mono text-[11px] text-ink-3">high+ open marked</span>
            </div>
            <div className="mt-3 flex h-24 items-end gap-2">
              {timeline.map((d) => (
                <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
                  <div className="relative flex w-full flex-1 items-end">
                    <div
                      className="w-full rounded-t-[4px] bg-line-strong"
                      style={{ height: `${(d.count / maxDay) * 100}%`, minHeight: d.count ? 4 : 0 }}
                      title={`${d.count} captures`}
                    >
                      {d.critical > 0 && (
                        <div className="h-1 w-full rounded-t-[4px] bg-high" title={`${d.critical} high or critical open`} />
                      )}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-ink-3">
                    {new Date(d.day).toLocaleDateString('en-GB', { weekday: 'short' })}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      {/* Pipeline status */}
      <section className="panel overflow-hidden">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="text-[13.5px] font-semibold">Pipeline status</h2>
          <span className="text-[12px] text-ink-3">Counts are live: probed and fetched from Cloudinary in this session.</span>
        </header>
        <ol className="grid grid-cols-2 divide-line sm:grid-cols-3 lg:grid-cols-6 lg:divide-x">
          {[
            { step: 'Raw media', value: `${field.length}`, note: 'captures ingested' },
            { step: 'Cloudinary', value: `${totals.measured}/${totals.total}`, note: 'renditions served' },
            { step: 'Understand', value: `${signalsReady}/${field.length}`, note: `AI signals · ${faceCount} faces in ${facesIn}` },
            { step: 'Structure', value: `${records.length}`, note: 'structured records' },
            { step: 'Search', value: `${field.reduce((n, a) => n + a.tags.length, 0)}`, note: 'indexed tags' },
            { step: 'Action', value: `${open.length}`, note: 'open actions' },
          ].map((s, i) => (
            <li key={s.step} className={cn('px-4 py-3.5', i > 0 && 'border-t border-line lg:border-t-0')}>
              <div className="label">
                {String(i + 1).padStart(2, '0')} · {s.step}
              </div>
              <div className="num mt-1.5 text-[22px] font-semibold tracking-[-0.02em]">{s.value}</div>
              <div className="mt-0.5 text-[12px] text-ink-3">{s.note}</div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  detail,
  accent = false,
  onClick,
}: {
  label: string;
  value: string;
  detail?: React.ReactNode;
  accent?: boolean;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn('panel flex flex-col px-4 py-3.5 text-left', onClick && 'transition-colors hover:border-line-strong')}
    >
      <span className="label">{label}</span>
      <span className={cn('num mt-2 text-[28px] font-semibold leading-none tracking-[-0.03em]', accent && 'text-signal')}>{value}</span>
      <div className="mt-2 text-[12px] text-ink-3">{detail}</div>
    </Tag>
  );
}

function Thumb({ asset }: { asset: MediaAsset }) {
  return (
    <span className="relative h-12 w-[72px] shrink-0 overflow-hidden rounded-[6px] border border-line bg-raised">
      <CloudImage src={thumbUrl(asset, 144, 96)} alt="" className="h-full w-full object-cover" />
    </span>
  );
}
