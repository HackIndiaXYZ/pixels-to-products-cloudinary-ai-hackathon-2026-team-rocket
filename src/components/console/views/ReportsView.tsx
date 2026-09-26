'use client';

import { FileJson, FileSpreadsheet, FileText, Fingerprint, Printer, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FindingStatus, MediaAsset, Severity } from '@/lib/types';
import { CATEGORIES, CATEGORY_LABEL, SEVERITIES, STATUS_LABEL, sitesOf } from '@/lib/analytics';
import { formatBytes, formatDateTime, isoDay, titleCase } from '@/lib/format';
import {
  REPORT_KINDS,
  ageHours,
  buildReport,
  downloadText,
  evidenceStillUrl,
  reportPayload,
  sha256Hex,
  toCsv,
  toMarkdown,
  type ReportModel,
} from '@/lib/report';
import type { CloudinaryInsight } from '@/lib/cloudinary/insights';
import type { DeliveryMetrics } from '@/lib/cloudinary/probe';
import { LogoMark } from '@/components/brand/Logo';
import { SEVERITY_COLOR } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { useConsole } from '../store';
import { useDeliveryTotals, useInsights } from '../hooks';
import { ViewHeader } from './ViewHeader';

export function ReportsView() {
  const { assets, now, reportKind, setReportKind, reportScope, setReportScope } = useConsole();
  const sites = sitesOf(assets);
  const model = useMemo(() => buildReport(reportKind, assets, reportScope, now), [reportKind, assets, reportScope, now]);
  const measured = useDeliveryTotals(model.assets);
  const insights = useInsights(reportKind === 'media' ? model.assets : []);
  const payload = useMemo(
    () => reportPayload(model, reportKind === 'media' ? measured.byAsset : {}),
    [model, reportKind, measured.byAsset],
  );
  const payloadJson = useMemo(() => JSON.stringify(payload, null, 2), [payload]);
  const [fingerprint, setFingerprint] = useState<{ json: string; hash: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    sha256Hex(payloadJson).then((hash) => {
      if (!cancelled) setFingerprint({ json: payloadJson, hash });
    });
    return () => {
      cancelled = true;
    };
  }, [payloadJson]);
  const hash = fingerprint?.json === payloadJson ? fingerprint.hash : null;

  const base = `visualops-${reportKind}-${isoDay(model.generatedAt)}`;
  const toggleStatus = (s: FindingStatus) =>
    setReportScope({
      ...reportScope,
      statuses: reportScope.statuses.includes(s) ? reportScope.statuses.filter((x) => x !== s) : [...reportScope.statuses, s],
    });
  const toggleSite = (s: string) =>
    setReportScope({ ...reportScope, sites: reportScope.sites.includes(s) ? reportScope.sites.filter((x) => x !== s) : [...reportScope.sites, s] });

  return (
    <div className="space-y-5">
      <ViewHeader
        title="Reports"
        subtitle="Evidence packages built from the structured records — Cloudinary stamps and redacts every frame"
      />

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        {/* Builder */}
        <aside className="no-print panel h-fit space-y-5 p-4 xl:sticky xl:top-[68px]">
          <section className="space-y-1.5">
            <h2 className="label">Template</h2>
            {REPORT_KINDS.map((k) => (
              <button
                key={k.kind}
                type="button"
                onClick={() => setReportKind(k.kind)}
                aria-pressed={reportKind === k.kind}
                className={cn(
                  'w-full rounded-[9px] border px-3 py-2.5 text-left transition-colors',
                  reportKind === k.kind ? 'border-signal bg-raised' : 'border-line hover:border-line-strong',
                )}
              >
                <span className="block text-[13px] font-medium">{k.name}</span>
                <span className="block text-[12px] leading-snug text-ink-3">{k.description}</span>
              </button>
            ))}
          </section>

          {reportScope.assetIds && (
            <div className="flex items-center justify-between gap-2 rounded-[8px] border border-signal/40 px-3 py-2 text-[12.5px]">
              <span>{reportScope.assetIds.length} assets selected from search</span>
              <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setReportScope({ ...reportScope, assetIds: null })} aria-label="Clear selection">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          <section className="space-y-2">
            <h2 className="label">Sites</h2>
            <div className="flex flex-wrap gap-1.5">
              {sites.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={reportScope.sites.includes(s)}
                  onClick={() => toggleSite(s)}
                  className={cn(
                    'rounded-[6px] border px-2 py-1 text-[12px] transition-colors',
                    reportScope.sites.includes(s) ? 'border-signal text-ink' : 'border-line text-ink-2 hover:border-line-strong',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="text-[11.5px] text-ink-3">{reportScope.sites.length ? `${reportScope.sites.length} selected` : 'All sites'}</p>
          </section>

          <section className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="label block">Min severity</span>
              <select
                className="input h-8 text-[12.5px]"
                value={reportScope.minSeverity}
                onChange={(e) => setReportScope({ ...reportScope, minSeverity: e.target.value as Severity })}
              >
                {[...SEVERITIES].reverse().map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                    {s !== 'critical' ? '+' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="label block">Captured</span>
              <select
                className="input h-8 text-[12.5px]"
                value={reportScope.windowDays === null ? 'all' : String(reportScope.windowDays)}
                onChange={(e) => setReportScope({ ...reportScope, windowDays: e.target.value === 'all' ? null : Number(e.target.value) })}
              >
                <option value="all">Any time</option>
                <option value="1">Last 24 h</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
              </select>
            </label>
          </section>

          <section className="space-y-2">
            <h2 className="label">Status</h2>
            <div className="flex flex-wrap gap-1.5">
              {(['open', 'monitoring', 'resolved'] as FindingStatus[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={reportScope.statuses.includes(s)}
                  onClick={() => toggleStatus(s)}
                  className={cn(
                    'rounded-[6px] border px-2 py-1 text-[12px] transition-colors',
                    reportScope.statuses.includes(s) ? 'border-signal text-ink' : 'border-line text-ink-3 hover:border-line-strong',
                  )}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </section>

          <label className="flex items-center justify-between gap-3 text-[12.5px]">
            <span>
              Redact faces in evidence
              <span className="block text-[11.5px] text-ink-3">Cloudinary e_pixelate_faces</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={reportScope.redactFaces}
              onClick={() => setReportScope({ ...reportScope, redactFaces: !reportScope.redactFaces })}
              className={cn(
                'relative h-5 w-9 shrink-0 rounded-full border transition-colors',
                reportScope.redactFaces ? 'border-signal bg-signal' : 'border-line-strong bg-canvas',
              )}
            >
              <span className={cn('absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all', reportScope.redactFaces ? 'left-[18px] bg-signal-ink' : 'left-0.5 bg-ink-3')} />
            </button>
          </label>

          <section className="space-y-2 border-t border-line pt-4">
            <h2 className="label">Export</h2>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => window.print()}>
                <Printer className="h-3.5 w-3.5" /> Print / PDF
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={!hash}
                onClick={() => hash && downloadText(`${base}.md`, toMarkdown(payload, hash), 'text/markdown')}
              >
                <FileText className="h-3.5 w-3.5" /> Markdown
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadText(`${base}.json`, payloadJson, 'application/json')}>
                <FileJson className="h-3.5 w-3.5" /> JSON
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadText(`${base}.csv`, toCsv(payload), 'text/csv')}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
              </button>
            </div>
            <p className="flex items-start gap-1.5 pt-1 text-[11.5px] leading-relaxed text-ink-3">
              <Fingerprint className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                SHA-256 of the JSON export, computed in your browser. Change anything and it changes.
                <span className="mt-0.5 block break-all font-mono text-[10.5px] text-ink-2">{hash ?? 'computing…'}</span>
              </span>
            </p>
          </section>
        </aside>

        {/* Document */}
        <ReportDocument
          model={model}
          hash={hash}
          measured={measured.byAsset}
          insights={insights}
          measuredCount={measured.measured}
        />
      </div>
    </div>
  );
}

function ReportDocument({
  model,
  hash,
  measured,
  insights,
  measuredCount,
}: {
  model: ReportModel;
  hash: string | null;
  measured: Record<string, DeliveryMetrics | undefined>;
  insights: Record<string, CloudinaryInsight | 'error' | undefined>;
  measuredCount: number;
}) {
  const now = new Date(model.generatedAt).getTime();
  return (
    <article className="print-root rounded-[12px] bg-paper px-6 py-7 text-paper-ink shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] sm:px-10 sm:py-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-black/15 pb-5">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[-0.01em]">
            <LogoMark className="h-4 w-4 text-paper-ink" /> VisualOps
          </div>
          <h2 className="mt-3 text-[26px] font-semibold leading-tight tracking-[-0.025em]">{model.title}</h2>
          <p className="mt-1 text-[13px] text-black/60">{model.scopeLabel}</p>
        </div>
        <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-right font-mono text-[11px] text-black/60">
          <dt>Generated</dt>
          <dd className="text-black/85">{formatDateTime(model.generatedAt)}</dd>
          <dt>Findings</dt>
          <dd className="text-black/85">{model.records.length}</dd>
          <dt>Assets</dt>
          <dd className="text-black/85">{model.assets.length}</dd>
          <dt>SHA-256</dt>
          <dd className="text-black/85">{hash ? `${hash.slice(0, 12)}…` : '…'}</dd>
        </dl>
      </header>

      <section className="grid grid-cols-2 gap-3 border-b border-black/15 py-5 sm:grid-cols-5">
        {SEVERITIES.map((s) => (
          <div key={s}>
            <div className="flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-black/55">
              <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: SEVERITY_COLOR[s] }} />
              {s}
            </div>
            <div className="num mt-1 text-[24px] font-semibold tracking-[-0.02em]">{model.counts[s]}</div>
          </div>
        ))}
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-black/55">open</div>
          <div className="num mt-1 text-[24px] font-semibold tracking-[-0.02em]">{model.openCount}</div>
        </div>
      </section>

      {model.kind === 'inspection' && (
        <section className="divide-y divide-black/10">
          {model.records.length === 0 && <Empty />}
          {model.records.map(({ finding, asset }) => (
            <div key={finding.id} className="print-break grid gap-4 py-5 sm:grid-cols-[240px_minmax(0,1fr)]">
              {/* eslint-disable-next-line @next/next/no-img-element -- stamped Cloudinary evidence frame */}
              <img
                src={evidenceStillUrl(asset, model.scope.redactFaces, 800)}
                alt={`Evidence for ${finding.id}`}
                className="w-full rounded-[6px] border border-black/10 bg-black/5"
              />
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                  <span>{finding.id}</span>
                  <span className="rounded-[4px] px-1.5 py-0.5 uppercase text-white" style={{ backgroundColor: SEVERITY_COLOR[finding.severity] }}>
                    {finding.severity}
                  </span>
                  <span className="text-black/55">
                    {CATEGORY_LABEL[finding.category]} · {STATUS_LABEL[finding.status]}
                  </span>
                </div>
                <h3 className="mt-1.5 text-[16px] font-semibold tracking-[-0.01em]">{finding.title}</h3>
                <p className="mt-0.5 text-[12px] text-black/55">
                  {asset.site}
                  {asset.zone ? ` · ${asset.zone}` : ''} · {formatDateTime(asset.capturedAt)} · {asset.fileName}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-black/80">{finding.summary}</p>
                <p className="mt-2 border-l-2 border-black/70 pl-3 text-[13px] leading-relaxed">
                  <span className="font-semibold">Action: </span>
                  {finding.action}
                </p>
              </div>
            </div>
          ))}
        </section>
      )}

      {model.kind === 'incident' && (
        <section className="overflow-x-auto py-4">
          {model.records.length === 0 ? (
            <Empty />
          ) : (
            <table className="w-full min-w-[640px] text-left text-[12.5px]">
              <thead className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-black/55">
                <tr className="border-b border-black/15">
                  <th className="py-2 pr-3 font-normal">ID</th>
                  <th className="py-2 pr-3 font-normal">Severity</th>
                  <th className="py-2 pr-3 font-normal">Finding</th>
                  <th className="py-2 pr-3 font-normal">Location</th>
                  <th className="py-2 pr-3 font-normal">Age</th>
                  <th className="py-2 font-normal">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/10 align-top">
                {model.records.map(({ finding, asset }) => (
                  <tr key={finding.id} className="print-break">
                    <td className="py-2.5 pr-3 font-mono text-[11px]">{finding.id}</td>
                    <td className="py-2.5 pr-3">
                      <span className="rounded-[4px] px-1.5 py-0.5 font-mono text-[10.5px] uppercase text-white" style={{ backgroundColor: SEVERITY_COLOR[finding.severity] }}>
                        {finding.severity}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-medium">{finding.title}</td>
                    <td className="py-2.5 pr-3 text-black/70">{asset.site}</td>
                    <td className="num py-2.5 pr-3 font-mono text-[11px]">{ageHours(asset.capturedAt, now)} h</td>
                    <td className="py-2.5 text-black/75">{finding.action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {model.kind === 'media' && (
        <section className="overflow-x-auto py-4">
          <p className="mb-3 text-[12px] text-black/55">
            Delivered sizes are measured live from Cloudinary’s Server-Timing header ({measuredCount}/{model.assets.length} measured). AI signals come from Cloudinary fl_getinfo.
          </p>
          <table className="w-full min-w-[720px] text-left text-[12.5px]">
            <thead className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-black/55">
              <tr className="border-b border-black/15">
                <th className="py-2 pr-3 font-normal">File</th>
                <th className="py-2 pr-3 font-normal">Type</th>
                <th className="py-2 pr-3 font-normal">Original</th>
                <th className="py-2 pr-3 font-normal">Delivered</th>
                <th className="py-2 pr-3 font-normal">Saved</th>
                <th className="py-2 font-normal">Faces</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {model.assets.map((a) => (
                <MediaRow key={a.id} asset={a} metrics={measured[a.id]} insight={insights[a.id]} />
              ))}
            </tbody>
          </table>
        </section>
      )}

      {model.kind === 'asset' && <AssetSummary assets={model.assets} />}

      <footer className="mt-6 border-t border-black/15 pt-4 font-mono text-[10.5px] leading-relaxed text-black/55">
        <div>SHA-256 (JSON export): {hash ?? 'computing…'}</div>
        <div>Evidence frames are delivered by Cloudinary with exposure correction, face redaction and an audit stamp — no generative edits.</div>
      </footer>
    </article>
  );
}

function MediaRow({ asset, metrics, insight }: { asset: MediaAsset; metrics?: DeliveryMetrics; insight?: CloudinaryInsight | 'error' }) {
  const original = asset.resourceType === 'image' ? metrics?.originalBytes ?? asset.bytes : asset.bytes;
  const saved = original && metrics?.bytes ? 1 - metrics.bytes / original : undefined;
  return (
    <tr className="print-break">
      <td className="py-2 pr-3 font-mono text-[11px]">{asset.fileName}</td>
      <td className="py-2 pr-3">{asset.resourceType}</td>
      <td className="num py-2 pr-3 font-mono text-[11px]">
        {asset.format.toUpperCase()} {formatBytes(original)}
      </td>
      <td className="num py-2 pr-3 font-mono text-[11px]">{metrics ? `${(metrics.format ?? '').toUpperCase()} ${formatBytes(metrics.bytes)}` : 'measuring…'}</td>
      <td className="num py-2 pr-3 font-mono text-[11px]">{saved !== undefined ? `${Math.round(saved * 100)}%` : '—'}</td>
      <td className="num py-2 font-mono text-[11px]">{insight && insight !== 'error' ? insight.faces.length : insight === 'error' ? 'n/a' : '…'}</td>
    </tr>
  );
}

function AssetSummary({ assets }: { assets: MediaAsset[] }) {
  const sites = Array.from(new Set(assets.map((a) => a.site))).sort();
  return (
    <section className="space-y-5 py-4">
      <table className="w-full text-left text-[12.5px]">
        <thead className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-black/55">
          <tr className="border-b border-black/15">
            <th className="py-2 pr-3 font-normal">Site</th>
            <th className="py-2 pr-3 font-normal">Photos</th>
            <th className="py-2 pr-3 font-normal">Videos</th>
            <th className="py-2 font-normal">Categories</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {sites.map((site) => {
            const rows = assets.filter((a) => a.site === site);
            const cats = CATEGORIES.filter((c) => rows.some((a) => a.finding?.category === c));
            return (
              <tr key={site}>
                <td className="py-2 pr-3 font-medium">{site}</td>
                <td className="num py-2 pr-3 font-mono">{rows.filter((a) => a.resourceType === 'image').length}</td>
                <td className="num py-2 pr-3 font-mono">{rows.filter((a) => a.resourceType === 'video').length}</td>
                <td className="py-2 text-black/70">{cats.map((c) => CATEGORY_LABEL[c]).join(', ') || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div>
        <h3 className="font-mono text-[10.5px] uppercase tracking-[0.05em] text-black/55">Assets</h3>
        <ul className="mt-2 grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
          {assets.map((a) => (
            <li key={a.id} className="flex justify-between gap-3 border-b border-black/5 py-1">
              <span className="truncate font-mono text-[11px]">{a.fileName}</span>
              <span className="shrink-0 text-black/55">{a.site}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Empty() {
  return <p className="py-10 text-center text-[13px] text-black/55">Nothing in scope. Widen the site, severity or status filters.</p>;
}
