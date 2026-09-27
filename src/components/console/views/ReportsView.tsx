'use client';

import { X } from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, type ReactNode } from 'react';
import type { FindingStatus, Severity } from '@/lib/types';
import { SEVERITIES, STATUSES, STATUS_LABEL, sitesOf } from '@/lib/analytics';
import { pluralize, titleCase } from '@/lib/format';
import { REPORT_KINDS, buildReport, downloadText, toCsv, toMarkdown, type ReportKind } from '@/lib/report';
import { cn } from '@/components/ui/cn';
import { useReducedMotionPref } from '@/components/motion/hooks';
import { useConsoleActions, useConsoleData, useConsoleRoute } from '../store';
import { ReportCompiler, type ExportFormat } from '../reports/ReportCompiler';
import { ReportDocument } from '../reports/ReportDocument';
import { STAGE_PACING_MS, claimHandoff, generateReport, scopeKey, useReportJob } from '../reports/job';
import { exportBase } from '../reports/format';
import { ViewHeader } from './ViewHeader';

/** Selects size to 16px on touch screens so iOS Safari does not zoom the page on focus. */
const SELECT = 'input h-8 text-[12.5px] pointer-coarse:h-9 pointer-coarse:text-base';

export const ReportsView = memo(function ReportsView() {
  const { assets, now } = useConsoleData();
  const { reportKind, reportScope } = useConsoleRoute();
  const { setReportKind, setReportScope, inspect } = useConsoleActions();
  const reduced = useReducedMotionPref();
  const sites = useMemo(() => sitesOf(assets), [assets]);

  // What a report would contain right now — drives the pre-run preview and staleness.
  const preview = useMemo(() => buildReport(reportKind, assets, reportScope, now), [reportKind, assets, reportScope, now]);
  const key = useMemo(() => scopeKey(reportKind, reportScope, preview), [reportKind, reportScope, preview]);

  const job = useReportJob();
  const running = job.run?.phase === 'running';
  const report = job.report;
  const stale = Boolean(report && report.key !== key);

  const generate = useCallback(() => {
    void generateReport({
      kind: reportKind,
      scope: reportScope,
      assets,
      now,
      key,
      scopeLabel: preview.scopeLabel,
      pacingMs: reduced ? 0 : STAGE_PACING_MS,
    });
  }, [reportKind, reportScope, assets, now, key, preview.scopeLabel, reduced]);

  // A selection handed over from search or incidents compiles straight away.
  const handoff = reportScope.assetIds;
  const reportKey = report?.key;
  useEffect(() => {
    if (!handoff || !claimHandoff(handoff)) return;
    if (reportKey === key) return;
    generate();
  }, [handoff, reportKey, key, generate]);

  const onExport = useCallback(
    (format: ExportFormat) => {
      if (!report || stale) return;
      const base = exportBase(report.model.kind, report.model.generatedAt);
      if (format === 'print') window.print();
      else if (format === 'md') downloadText(`${base}.md`, toMarkdown(report.payload, report.hash), 'text/markdown');
      else if (format === 'json') downloadText(`${base}.json`, report.json, 'application/json');
      else downloadText(`${base}.csv`, toCsv(report.payload), 'text/csv');
    },
    [report, stale],
  );

  const toggleStatus = (s: FindingStatus) =>
    setReportScope({
      ...reportScope,
      statuses: reportScope.statuses.includes(s) ? reportScope.statuses.filter((x) => x !== s) : [...reportScope.statuses, s],
    });
  const toggleSite = (s: string) =>
    setReportScope({ ...reportScope, sites: reportScope.sites.includes(s) ? reportScope.sites.filter((x) => x !== s) : [...reportScope.sites, s] });

  const previewSites = new Set(preview.assets.map((a) => a.site)).size;

  return (
    <div className="space-y-5">
      <ViewHeader
        title="Reports"
        subtitle={`Evidence packages compiled from the structured records — every frame rendered and stamped by Cloudinary${
          reportScope.redactFaces ? '; faces it detects are pixelated' : ''
        }`}
      />

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* Builder */}
        <aside className="no-print panel h-fit xl:sticky xl:top-[68px] xl:max-h-[calc(100vh-84px)] xl:overflow-y-auto" aria-label="Report builder">
          <section className="p-4" aria-labelledby="report-template-label">
            <h2 id="report-template-label" className="label mb-2.5">
              Template
            </h2>
            <div className="overflow-hidden rounded-[8px] border border-line">
              {REPORT_KINDS.map((k, i) => (
                <TemplateOption key={k.kind} index={i} kind={k.kind} name={k.name} description={k.description} active={reportKind === k.kind} onSelect={setReportKind} />
              ))}
            </div>
          </section>

          <div className="space-y-5 border-t border-line p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="label">Scope</h2>
              <span className="num font-mono text-[11px] text-ink-3" aria-live="polite">
                {pluralize(preview.assets.length, 'asset')} · {pluralize(preview.records.length, 'finding')} · {pluralize(previewSites, 'site')}
              </span>
            </div>

            {reportScope.assetIds && (
              <div className="flex items-center justify-between gap-2 rounded-[7px] border border-[color-mix(in_oklab,var(--color-signal)_40%,transparent)] py-1.5 pl-3 pr-1.5 text-[12.5px]">
                <span className="min-w-0">
                  <span className="block text-ink">{pluralize(reportScope.assetIds.length, 'asset')} selected</span>
                  <span className="block text-[11.5px] text-ink-3">Handed over from search, incidents or the Inspector</span>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon shrink-0"
                  onClick={() => setReportScope({ ...reportScope, assetIds: null })}
                  aria-label="Clear selection"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            <section className="space-y-2">
              <div className="flex items-baseline justify-between">
                <h3 className="text-[12.5px] text-ink-2">Sites</h3>
                <span className="text-[11.5px] text-ink-3">{reportScope.sites.length ? `${reportScope.sites.length} selected` : 'All sites'}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sites.map((s) => (
                  <ToggleChip key={s} active={reportScope.sites.includes(s)} onClick={() => toggleSite(s)}>
                    {s}
                  </ToggleChip>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-2 gap-3">
              <label className="space-y-1.5">
                <span className="block text-[12.5px] text-ink-2">Min severity</span>
                <select
                  className={SELECT}
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
              <label className="space-y-1.5">
                <span className="block text-[12.5px] text-ink-2">Captured</span>
                <select
                  className={SELECT}
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
              <h3 className="text-[12.5px] text-ink-2">Status</h3>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <ToggleChip key={s} active={reportScope.statuses.includes(s)} onClick={() => toggleStatus(s)}>
                    {STATUS_LABEL[s]}
                  </ToggleChip>
                ))}
              </div>
              {reportKind === 'incident' && <p className="text-[11.5px] text-ink-3">Incident summaries leave out resolved findings.</p>}
            </section>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-line p-4 text-[12.5px]">
            <span className="min-w-0">
              <span id="redact-label" className="block text-ink">
                Redact faces in evidence
              </span>
              <span id="redact-note" className="block text-[11.5px] leading-snug text-ink-3">
                <span className="font-mono text-[11px]">e_pixelate_faces</span> · faces Cloudinary detects
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={reportScope.redactFaces}
              aria-labelledby="redact-label"
              aria-describedby="redact-note"
              onClick={() => setReportScope({ ...reportScope, redactFaces: !reportScope.redactFaces })}
              className={cn(
                'relative h-5 w-9 shrink-0 rounded-full border transition-colors duration-200',
                reportScope.redactFaces ? 'border-signal bg-signal' : 'border-line-strong bg-canvas',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'absolute left-0.5 top-0.5 h-3.5 w-3.5 rounded-full transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
                  reportScope.redactFaces ? 'translate-x-4 bg-signal-ink' : 'translate-x-0 bg-ink-3',
                )}
              />
            </button>
          </div>
        </aside>

        {/* Sequence → document */}
        <div className="min-w-0 space-y-4">
          <ReportCompiler job={job} kind={reportKind} preview={preview} stale={stale} onGenerate={generate} onExport={onExport} />
          {report && !running ? (
            <ReportDocument key={report.runId} report={report} stale={stale} onInspect={inspect} />
          ) : (
            !running && <Blueprint kind={reportKind} />
          )}
        </div>
      </div>
    </div>
  );
});

function TemplateOption({
  index,
  kind,
  name,
  description,
  active,
  onSelect,
}: {
  index: number;
  kind: ReportKind;
  name: string;
  description: string;
  active: boolean;
  onSelect: (kind: ReportKind) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(kind)}
      aria-pressed={active}
      className={cn(
        'relative flex w-full gap-3 border-t border-line px-3 py-2.5 text-left transition-colors first:border-t-0',
        active ? 'bg-raised' : 'hover:bg-[color-mix(in_oklab,var(--color-raised)_55%,transparent)]',
      )}
    >
      <span aria-hidden className={cn('absolute inset-y-0 left-0 w-[2px] bg-signal transition-opacity', active ? 'opacity-100' : 'opacity-0')} />
      <span className={cn('pt-[2px] font-mono text-[10.5px]', active ? 'text-signal' : 'text-ink-3')}>{String.fromCharCode(65 + index)}</span>
      <span className="min-w-0">
        <span className={cn('block text-[13px] font-medium', active ? 'text-ink' : 'text-ink-2')}>{name}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">{description}</span>
      </span>
    </button>
  );
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'rounded-[6px] border px-2 py-1 text-[12px] transition-colors',
        active
          ? 'border-signal bg-[color-mix(in_oklab,var(--color-signal)_10%,transparent)] text-ink'
          : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

/** Before the first run: the anatomy of the document the chosen template will issue. */
function Blueprint({ kind }: { kind: ReportKind }) {
  const sections: Record<ReportKind, string> = {
    inspection: 'Findings — observation, required action and a stamped evidence frame each',
    incident: 'Incident register — open and monitoring, worst first, with age',
    media: 'Media and delivery — original vs delivered bytes, measured from Cloudinary',
    asset: 'Asset inventory — what exists, where, and of what type',
  };
  const rows = [
    ['Cover', 'Title, scope, filters, redaction and document ID'],
    ['01', kind === 'media' || kind === 'asset' ? 'Summary — media counts and sizes' : 'Summary — findings by severity and by site'],
    ['02', sections[kind]],
    ['03', 'Evidence manifest — every frame requested from Cloudinary, with its HTTP status and face redaction'],
    ['04', 'Integrity — SHA-256 of the JSON export'],
  ];
  return (
    <section aria-label="Document outline" className="survey-grid rounded-[10px] border border-dashed border-line-strong px-5 py-6 sm:px-8 sm:py-8">
      <p className="label">Document outline · not yet issued</p>
      <ol className="mt-5 max-w-[640px] divide-y divide-line border-y border-line">
        {rows.map(([n, text]) => (
          <li key={n} className="grid grid-cols-[56px_minmax(0,1fr)] gap-3 py-2.5 text-[13px]">
            <span className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">{n}</span>
            <span className="text-ink-2">{text}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 max-w-[56ch] text-[12.5px] leading-relaxed text-ink-3">
        Generate the report to compile it: the sequence scopes the media, builds the records, requests every evidence frame from Cloudinary
        (recording whether it was delivered and which faces Cloudinary detected) and seals the package with a SHA-256 fingerprint.
      </p>
    </section>
  );
}
