'use client';

import { motion } from 'framer-motion';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileCheck2,
  FileJson,
  FileSpreadsheet,
  FileText,
  Fingerprint,
  Loader2,
  Printer,
  RotateCw,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SEVERITIES } from '@/lib/analytics';
import { formatBytes, formatDateTime, pluralize } from '@/lib/format';
import { REPORT_KINDS, hashVerifyCommand, type ReportKind, type ReportModel } from '@/lib/report';
import { SEVERITY_COLOR } from '@/components/ui/badges';
import { CopyButton } from '@/components/ui/CopyButton';
import { cn } from '@/components/ui/cn';
import { useRafLoop } from '@/components/motion/hooks';
import {
  STAGES,
  claimReceiptFocus,
  type EvidenceProbe,
  type JobState,
  type ReportRun,
  type ReportSnapshot,
  type StageId,
  type StageStatus,
} from './job';
import { documentId, exportBase, formatWork, groupHash } from './format';

export type ExportFormat = 'print' | 'md' | 'json' | 'csv';

const EASE = [0.16, 1, 0.3, 1] as const;
const kindName = (kind: ReportKind) => REPORT_KINDS.find((k) => k.kind === kind)?.name ?? 'Report';

/**
 * What the persistent status region says. It follows the job: the start of a run, each stage as it begins,
 * then the issued package (or that it was superseded). A failure is announced by the role="alert" message
 * instead, so the region falls silent. Rapid stage changes may be coalesced by the screen reader; the
 * completion message is the one that must land.
 */
function announcement(job: JobState, stale: boolean): string {
  const { run, report } = job;
  if (!run) return '';
  if (run.phase === 'running') {
    let started = -1;
    STAGES.forEach((s, i) => {
      if (run.stages[s.id].status !== 'pending') started = i;
    });
    return started < 0
      ? `Generating ${kindName(run.kind).toLowerCase()}…`
      : `Stage ${started + 1} of ${STAGES.length}: ${STAGES[started].name}`;
  }
  if (run.phase === 'failed' || !report || report.runId !== run.id) return '';
  if (stale) return 'Scope or records changed — the report shown is superseded. Regenerate to update it.';
  const frames = report.evidence.length;
  const delivered = report.evidence.filter((e) => e.state === 'delivered').length;
  return (
    `Report ready — ${documentId(report.hash)}, SHA-256 ${report.hash.slice(0, 8)}.` +
    (frames ? ` ${delivered} of ${pluralize(frames, 'evidence frame')} delivered by Cloudinary.` : '')
  );
}

/**
 * The report sequence. Before and during a run it is the full stage list;
 * once the package is built it folds into a receipt (status, SHA-256, exports)
 * and the document unfolds beneath it. A status region that stays mounted
 * across both states announces the stages and the result.
 */
export function ReportCompiler(props: {
  job: JobState;
  kind: ReportKind;
  preview: ReportModel;
  stale: boolean;
  onGenerate: () => void;
  onExport: (format: ExportFormat) => void;
}) {
  return (
    <>
      <p role="status" className="sr-only">
        {announcement(props.job, props.stale)}
      </p>
      <Sequence {...props} />
    </>
  );
}

function Sequence({
  job,
  kind,
  preview,
  stale,
  onGenerate,
  onExport,
}: {
  job: JobState;
  kind: ReportKind;
  preview: ReportModel;
  stale: boolean;
  onGenerate: () => void;
  onExport: (format: ExportFormat) => void;
}) {
  const { run, report } = job;
  const running = run?.phase === 'running';
  const failed = run?.phase === 'failed';
  const generateRef = useRef<HTMLButtonElement>(null);

  // A run started from the receipt's Regenerate unmounts the button that had focus; keep focus on the
  // (aria-disabled) Generate button instead of letting it fall to <body>.
  const runningId = running && run ? run.id : null;
  useEffect(() => {
    if (runningId === null) return;
    const active = document.activeElement;
    if (!active || active === document.body) generateRef.current?.focus({ preventScroll: true });
  }, [runningId]);

  if (report && !running && !failed) {
    return (
      <Receipt
        key={report.runId}
        report={report}
        run={run && run.id === report.runId ? run : null}
        stale={stale}
        preview={preview}
        onGenerate={onGenerate}
        onExport={onExport}
      />
    );
  }

  const shownKind = running && run ? run.kind : kind;
  const scopeLabel = running && run ? run.scopeLabel : preview.scopeLabel;

  return (
    <section className="no-print panel overflow-hidden" aria-label="Report sequence" aria-busy={running}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="label flex items-center gap-2">
            {running ? (
              <>
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-signal animate-pulse-dot" />
                <span className="text-signal">Generating</span>
              </>
            ) : failed ? (
              <span className="text-critical">Sequence stopped</span>
            ) : (
              'Report sequence'
            )}
          </div>
          <p className="mt-1.5 truncate text-[15px] tracking-[-0.01em] text-ink">
            <span className="font-medium">{kindName(shownKind)}</span>
            <span className="text-ink-3"> · {scopeLabel}</span>
          </p>
        </div>
        {running && run && <RunClock startedAt={run.startedAt} />}
        {/* aria-disabled, not disabled: a disabled button drops keyboard focus to <body> mid-run. */}
        <button
          ref={generateRef}
          type="button"
          className="btn btn-primary aria-disabled:cursor-progress aria-disabled:bg-signal aria-disabled:opacity-60 aria-disabled:shadow-none aria-disabled:transform-none"
          aria-disabled={running || undefined}
          onClick={() => {
            if (running) return;
            onGenerate();
          }}
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
          {running ? 'Generating…' : failed ? 'Try again' : 'Generate report'}
        </button>
      </header>

      {failed && run?.error && (
        <p role="alert" className="flex items-start gap-2 border-t border-line bg-[color-mix(in_oklab,var(--color-critical)_8%,transparent)] px-4 py-2.5 text-[12.5px] text-ink sm:px-5">
          <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-critical" />
          <span>
            No report was issued — the sequence stopped with: <span className="font-mono text-[11.5px] text-ink-2">{run.error}</span>
          </span>
        </p>
      )}

      <StageList run={running || failed ? run : null} preview={preview} kind={shownKind} />
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Stage list                                                                */
/* ------------------------------------------------------------------------ */

function StageList({ run, preview, kind }: { run: ReportRun | null; preview: ReportModel; kind: ReportKind }) {
  const failed = run?.phase === 'failed';
  const statusOf = (id: StageId): StageStatus | 'failed' => {
    const s = run?.stages[id].status ?? 'pending';
    return failed && s === 'active' ? 'failed' : s;
  };
  const previewSites = new Set(preview.assets.map((a) => a.site)).size;
  const media = kind === 'media';
  const collect = run?.collect;
  const analyze = run?.analyze;
  const pkg = run?.pkg;

  return (
    <ol className="border-t border-line">
      {STAGES.map((stage, i) => {
        const status = statusOf(stage.id);
        return (
          <StageRow key={stage.id} index={i + 1} name={stage.name} feeds={stage.feeds} status={status} ms={run?.stages[stage.id].ms}>
            {stage.id === 'collect' &&
              (collect ? (
                <>
                  <p>
                    <b className="num font-medium text-ink">{collect.assets}</b> {collect.assets === 1 ? 'asset' : 'assets'} ·{' '}
                    {pluralize(collect.photos, 'photo')}, {pluralize(collect.videos, 'video')} · {pluralize(collect.sites.length, 'site')}
                  </p>
                  {collect.sites.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {collect.sites.map((s) => (
                        <li key={s} className="rounded-[4px] border border-line px-1.5 py-[3px] text-[11.5px] leading-none text-ink-2">
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p>
                  {pluralize(preview.assets.length, 'asset')} across {pluralize(previewSites, 'site')} in scope
                </p>
              ))}

            {stage.id === 'analyze' &&
              (analyze ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                  <p>
                    <b className="num font-medium text-ink">{analyze.findings}</b> {analyze.findings === 1 ? 'finding' : 'findings'} ·{' '}
                    {analyze.open} open · {analyze.monitoring} monitoring
                    {analyze.findings > 0 && (
                      <>
                        {' '}
                        · <span className="num">{analyze.ai}</span> with Cloudinary AI understanding
                      </>
                    )}
                  </p>
                  <p className="flex flex-wrap gap-x-3 font-mono text-[11px] text-ink-3">
                    {SEVERITIES.map((s) => (
                      <span key={s} className="flex items-center gap-1.5">
                        <span aria-hidden className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: SEVERITY_COLOR[s] }} />
                        <span className="uppercase">{s}</span>
                        <span className="num text-ink">{analyze.counts[s]}</span>
                      </span>
                    ))}
                  </p>
                </div>
              ) : (
                <p>
                  {preview.records.length === 1 ? '1 finding matches' : `${preview.records.length} findings match`} the severity and status
                  filters
                </p>
              ))}

            {stage.id === 'attach' &&
              (run && (status === 'active' || status === 'done' || status === 'warn' || status === 'failed') ? (
                <AttachDetail run={run} />
              ) : (
                <p>
                  {preview.records.length
                    ? `${pluralize(preview.records.length, 'stamped evidence frame')} to request from Cloudinary · face detections read for each`
                    : 'No findings in scope — nothing to attach'}
                  {media ? ` · ${pluralize(preview.assets.length, 'delivered rendition')} to measure` : ''}
                </p>
              ))}

            {stage.id === 'package' &&
              (pkg ? (
                <p className="font-mono text-[11.5px] text-ink-2">
                  {pkg.schema} · {formatBytes(pkg.jsonBytes)} JSON · SHA-256 <span className="text-ink">{pkg.hash.slice(0, 16)}…</span>
                </p>
              ) : (
                <p>
                  Canonical JSON payload — records with provenance, Cloudinary AI understanding, evidence URLs and their delivery results — and its
                  SHA-256, computed in this browser
                </p>
              ))}
          </StageRow>
        );
      })}
      <ReadyRow run={run} />
    </ol>
  );
}

function StageRow({
  index,
  name,
  feeds,
  status,
  ms,
  children,
}: {
  index: number;
  name: string;
  feeds: string;
  status: StageStatus | 'failed';
  ms?: number;
  children: ReactNode;
}) {
  const pending = status === 'pending';
  return (
    <li className="relative grid grid-cols-[24px_minmax(0,1fr)_auto] gap-x-3 border-t border-line px-4 py-3.5 first:border-t-0 sm:px-5">
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 left-0 w-[2px] origin-top bg-signal transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          status === 'active' ? 'scale-y-100' : 'scale-y-0',
        )}
      />
      <span className="num pt-[2px] font-mono text-[10.5px] text-ink-3">{String(index).padStart(2, '0')}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className={cn('font-mono text-[11.5px] uppercase tracking-[0.1em]', pending ? 'text-ink-3' : 'text-ink')}>{name}</span>
          <span className="hidden text-[11px] text-ink-3 sm:inline">→ {feeds}</span>
        </div>
        <motion.div
          key={pending ? 'preview' : 'result'}
          initial={pending ? false : { opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, ease: EASE }}
          className={cn('mt-1 text-[13px] leading-snug', pending ? 'text-ink-3' : 'text-ink-2')}
        >
          {children}
        </motion.div>
      </div>
      <div className="flex items-start gap-2.5 pt-[1px]">
        {ms !== undefined && <span className="num font-mono text-[11px] text-ink-3">{formatWork(ms)}</span>}
        <StageMark status={status} />
      </div>
    </li>
  );
}

function StageMark({ status }: { status: StageStatus | 'failed' }) {
  if (status === 'done') return <Check aria-label="Done" className="h-3.5 w-3.5 text-signal" />;
  if (status === 'warn') return <AlertTriangle aria-label="Completed with warnings" className="h-3.5 w-3.5 text-warn" />;
  if (status === 'failed') return <X aria-label="Failed" className="h-3.5 w-3.5 text-critical" />;
  if (status === 'active') {
    return (
      <span aria-label="Running" className="grid h-3.5 w-3.5 place-items-center">
        <span className="h-2 w-2 rounded-[2px] bg-signal animate-pulse-dot" />
      </span>
    );
  }
  return (
    <span aria-label="Pending" className="grid h-3.5 w-3.5 place-items-center">
      <span className="h-2 w-2 rounded-[2px] border border-line-strong" />
    </span>
  );
}

function ReadyRow({ run }: { run: ReportRun | null }) {
  const ready = run?.phase === 'ready';
  const work = run
    ? STAGES.reduce((sum, s) => sum + (run.stages[s.id].ms ?? 0), 0)
    : undefined;
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)_auto] gap-x-3 border-t border-line px-4 py-3 sm:px-5">
      <span aria-hidden className="pt-[2px] font-mono text-[10.5px] text-ink-3">—</span>
      <span className={cn('font-mono text-[11.5px] uppercase tracking-[0.1em]', ready ? 'text-signal' : 'text-ink-3')}>Report ready</span>
      <span className="flex items-center gap-2.5">
        {ready && <span className="num font-mono text-[11px] text-ink-3">{formatWork(work)} work</span>}
        <StageMark status={ready ? 'done' : 'pending'} />
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------------ */
/* Attaching evidence: real probe progress                                   */
/* ------------------------------------------------------------------------ */

function AttachDetail({ run }: { run: ReportRun }) {
  const settled = run.evidence.filter((e) => e.state !== 'pending');
  const delivered = settled.filter((e) => e.state === 'delivered').length;
  const failures = settled.filter((e) => e.state === 'failed');
  const total = run.evidence.length + (run.delivery?.total ?? 0) + (run.signals?.total ?? 0);
  const done = settled.length + (run.delivery?.done ?? 0) + (run.signals?.done ?? 0);
  const progress = total ? done / total : 1;
  // Known once the stage has finished: face detections per frame, from fl_getinfo.
  const read = run.evidence.filter((e) => Array.isArray(e.faces));
  const faces = read.reduce((n, e) => n + (Array.isArray(e.faces) ? e.faces.length : 0), 0);

  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        {run.evidence.length ? (
          <span>
            <b className="num font-medium text-ink">
              {delivered}/{run.evidence.length}
            </b>{' '}
            evidence {run.evidence.length === 1 ? 'frame' : 'frames'} delivered by Cloudinary ·{' '}
            <span className="num">{formatBytes(run.evidenceBytes)}</span>
          </span>
        ) : (
          <span>No findings in scope — nothing to attach</span>
        )}
        {failures.length > 0 && <span className="text-warn">{failures.length} not delivered</span>}
        {run.delivery && (
          <span className="num font-mono text-[11px] text-ink-3">
            renditions {run.delivery.done}/{run.delivery.total}
          </span>
        )}
        {run.signals && (
          <span className="num font-mono text-[11px] text-ink-3">
            fl_getinfo {run.signals.done}/{run.signals.total}
            {read.length > 0 && ` · ${faces} face ${faces === 1 ? 'detection' : 'detections'}`}
          </span>
        )}
      </p>

      {total > 0 && (
        <div className="mt-2.5 h-[2px] w-full overflow-hidden rounded-full bg-line" aria-hidden>
          <div
            className="h-full w-full origin-left bg-signal transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      )}

      {run.evidence.length > 0 && (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(98px,1fr))] gap-1.5" aria-label="Evidence frames">
          {run.evidence.map((e) => (
            <EvidenceCell key={e.findingId} probe={e} />
          ))}
        </ul>
      )}

      {failures.length > 0 && (
        <ul className="mt-2.5 space-y-1 font-mono text-[11px] text-warn">
          {failures.slice(0, 4).map((f) => (
            <li key={f.findingId} className="truncate">
              {[f.findingId, f.httpStatus ? `HTTP ${f.httpStatus}` : '', f.reason ?? (f.httpStatus ? '' : 'no answer')].filter(Boolean).join(' · ')}
            </li>
          ))}
          {failures.length > 4 && <li>+{failures.length - 4} more — listed in the evidence manifest</li>}
        </ul>
      )}
    </div>
  );
}

function EvidenceCell({ probe }: { probe: EvidenceProbe }) {
  const m = probe.metrics;
  return (
    <li
      className={cn(
        'relative overflow-hidden rounded-[4px] border px-2 py-1.5 font-mono text-[10.5px] leading-tight',
        probe.state === 'failed' ? 'border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)]' : 'border-line',
      )}
      title={probe.state === 'failed' ? (probe.reason ?? (probe.httpStatus ? `HTTP ${probe.httpStatus}` : 'No answer')) : probe.url}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 bg-[color-mix(in_oklab,var(--color-signal)_9%,transparent)] opacity-0 transition-opacity duration-300',
          probe.state === 'delivered' && 'opacity-100',
        )}
      />
      <span className="relative flex items-center justify-between gap-1">
        <span className="text-ink">{probe.findingId}</span>
        {probe.state === 'delivered' ? (
          <Check className="h-3 w-3 text-signal" aria-label="Delivered" />
        ) : probe.state === 'failed' ? (
          <AlertTriangle className="h-3 w-3 text-warn" aria-label="Not delivered" />
        ) : (
          <span aria-label="Requesting" className="h-1.5 w-1.5 rounded-full bg-ink-3 animate-pulse-dot" />
        )}
      </span>
      <span className="num relative mt-1 block truncate text-ink-3">
        {probe.state === 'pending'
          ? 'HEAD …'
          : probe.state === 'delivered'
            ? `${(m?.format ?? '').toUpperCase()} ${formatBytes(m?.bytes)}`
            : probe.httpStatus
              ? `HTTP ${probe.httpStatus}`
              : 'no answer'}
      </span>
    </li>
  );
}

/** Wall-clock elapsed time of the running sequence, written to the DOM without re-rendering. */
function RunClock({ startedAt }: { startedAt: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const last = useRef(0);
  useRafLoop((time) => {
    if (time - last.current < 50) return;
    last.current = time;
    if (ref.current) ref.current.textContent = `${((performance.now() - startedAt) / 1000).toFixed(2)} s`;
  }, true);
  return (
    <span ref={ref} className="num font-mono text-[12px] text-ink-2" aria-hidden>
      0.00 s
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Receipt: the ready (or superseded) package                                */
/* ------------------------------------------------------------------------ */

function Receipt({
  report,
  run,
  stale,
  preview,
  onGenerate,
  onExport,
}: {
  report: ReportSnapshot;
  run: ReportRun | null;
  stale: boolean;
  preview: ReportModel;
  onGenerate: () => void;
  onExport: (format: ExportFormat) => void;
}) {
  const [logOpen, setLogOpen] = useState(false);
  const delivered = report.evidence.filter((e) => e.state === 'delivered').length;
  const frames = report.evidence.length;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const justFinished = run?.phase === 'ready';

  // On completion the sequence (and its Generate button) unmounts: hand focus to this heading so keyboard
  // and screen-reader users land on the result. Once per run, and never away from something else the user
  // has focused meanwhile (e.g. a scope control, or the sidebar when returning to the view later).
  useEffect(() => {
    if (!justFinished || !claimReceiptFocus(report.runId)) return;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const heading = headingRef.current;
    if (!heading) return;
    heading.focus({ preventScroll: true });
    const r = heading.getBoundingClientRect();
    if (r.top < 64 || r.bottom > window.innerHeight) heading.scrollIntoView({ block: 'nearest' });
  }, [justFinished, report.runId]);

  return (
    <motion.section
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.36, ease: EASE }}
      aria-label="Report package"
      className={cn(
        'no-print panel overflow-hidden transition-colors',
        stale && 'border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)]',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
        <h2
          ref={headingRef}
          tabIndex={-1}
          className={cn(
            'flex scroll-mt-20 items-center gap-2 font-mono text-[11.5px] font-normal uppercase tracking-[0.1em]',
            stale ? 'text-warn' : 'text-signal',
          )}
        >
          {stale ? (
            <>
              <AlertTriangle aria-hidden className="h-3.5 w-3.5" /> Changed — regenerate
            </>
          ) : (
            <>
              <Check aria-hidden className="h-3.5 w-3.5" /> Report ready
            </>
          )}
        </h2>
        <p className="min-w-0 flex-1 basis-[260px] text-[12.5px] leading-snug text-ink-2">
          {stale ? (
            <>
              The document below was built for a previous template, scope or record state (e.g. a new Cloudinary AI analysis). Its hash and
              exports no longer describe the current selection
              {' '}({kindName(preview.kind)} · {preview.scopeLabel}).
            </>
          ) : (
            <>
              Generated {formatDateTime(report.model.generatedAt)} ·{' '}
              {frames
                ? `${delivered}/${frames} evidence ${frames === 1 ? 'frame' : 'frames'} delivered by Cloudinary (HTTP 200)`
                : 'no evidence frames in scope'}{' '}
              · <span className="num">{formatWork(report.workMs)}</span> work
            </>
          )}
        </p>
        <div className="flex items-center gap-2">
          {run && (
            <button type="button" className="btn btn-ghost btn-sm" aria-expanded={logOpen} onClick={() => setLogOpen((v) => !v)}>
              Run log
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform duration-200', logOpen && 'rotate-180')} />
            </button>
          )}
          <button type="button" className={cn('btn btn-sm', stale ? 'btn-primary' : 'btn-secondary')} onClick={onGenerate}>
            <RotateCw className="h-3.5 w-3.5" /> Regenerate
          </button>
        </div>
      </div>

      <div className="grid gap-3 border-t border-line px-4 py-3 sm:px-5 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="label flex items-center gap-1.5">
            <Fingerprint className="h-3 w-3" /> SHA-256 · JSON export
            {stale && <span className="ml-1 text-warn">superseded</span>}
          </div>
          <p
            className={cn(
              // groupHash() spaces the digest every 8 characters, so lines wrap between groups, never inside one.
              'num mt-1 break-normal font-mono text-[12px] leading-relaxed',
              stale ? 'text-ink-3 line-through decoration-[color-mix(in_oklab,var(--color-ink-3)_70%,transparent)]' : 'text-ink',
            )}
          >
            {groupHash(report.hash)}
          </p>
          <p className="mt-1 text-[11.5px] leading-snug text-ink-3">
            Covers the exported JSON: records + evidence URLs + delivery results. Recompute with{' '}
            <code className="font-mono text-[11px] text-ink-2">{hashVerifyCommand(`${exportBase(report.model.kind, report.model.generatedAt)}.json`)}</code>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary btn-sm" disabled={stale} onClick={() => onExport('print')}>
            <Printer className="h-3.5 w-3.5" /> Print / PDF
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={stale} onClick={() => onExport('md')}>
            <FileText className="h-3.5 w-3.5" /> Markdown
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={stale} onClick={() => onExport('json')}>
            <FileJson className="h-3.5 w-3.5" /> JSON
          </button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={stale} onClick={() => onExport('csv')}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
          </button>
          {!stale && <CopyButton value={report.hash} iconOnly label="Copy SHA-256" />}
        </div>
      </div>

      {logOpen && run && <StageList run={run} preview={preview} kind={run.kind} />}
    </motion.section>
  );
}
