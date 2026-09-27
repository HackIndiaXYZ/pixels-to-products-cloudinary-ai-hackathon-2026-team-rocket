'use client';

/**
 * Report generation as a real, staged system operation.
 *
 *   GENERATE REPORT
 *     → COLLECTING MEDIA         scope the asset set (sites, window, selection)
 *     → ANALYZING FINDINGS       build the finding records and severity counts
 *     → ATTACHING EVIDENCE       HEAD-request every stamped evidence frame from Cloudinary, in parallel,
 *                                and read Cloudinary's face detections (fl_getinfo, cached) for each frame
 *     → BUILDING AUDIT PACKAGE   canonical JSON payload + SHA-256 (Web Crypto)
 *     → REPORT READY
 *
 * The job lives outside React (a tiny external store read through
 * useSyncExternalStore) so it survives view switches, can be started from an
 * effect without setState, and only notifies subscribers when a stage or a
 * probe actually changes — coalesced to at most once per frame, never a
 * per-frame tick.
 *
 * Every number a stage reports is the result of the work it just did. The only
 * addition is a short presentational hold (≤ STAGE_PACING_MS) after stages that
 * finish in well under a millisecond, so the sequence stays readable; that hold
 * is never counted in the reported stage times.
 */

import { useSyncExternalStore } from 'react';
import type { MediaAsset, Region, Severity } from '@/lib/types';
import {
  buildReport,
  evidenceStillUrl,
  reportPayload,
  scopeAssets,
  sha256Hex,
  type ReportKind,
  type ReportModel,
  type ReportPayload,
  type ReportScope,
} from '@/lib/report';
import { IMAGE_ACCEPT, measure, schedulePerFrame, type DeliveryMetrics, type ProbeResult } from '@/lib/cloudinary/probe';
import { fetchInsight, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import { servedUrl } from '../hooks';

export type StageId = 'collect' | 'analyze' | 'attach' | 'package';

export const STAGES: ReadonlyArray<{ id: StageId; name: string; feeds: string }> = [
  { id: 'collect', name: 'Collecting media', feeds: 'Cover · scope' },
  { id: 'analyze', name: 'Analyzing findings', feeds: 'Summary · records' },
  { id: 'attach', name: 'Attaching evidence', feeds: 'Evidence frames · manifest' },
  { id: 'package', name: 'Building audit package', feeds: 'JSON export · SHA-256' },
];

/** Presentational hold for stages whose real work finishes faster than this. Never reported as work time. */
export const STAGE_PACING_MS = 180;
/** Width of the evidence rendition the document shows — the exact URL the attach stage requests. */
export const EVIDENCE_WIDTH = 800;
const PROBE_TIMEOUT_MS = 20_000;

export type StageStatus = 'pending' | 'active' | 'done' | 'warn';

export interface StageRun {
  status: StageStatus;
  /** Real work time of the stage, in milliseconds. */
  ms?: number;
}

export interface EvidenceProbe {
  /** Figure number in the document (record order). */
  fig: number;
  assetId: string;
  findingId: string;
  url: string;
  /** 'delivered': Cloudinary answered HTTP 2xx for exactly this rendition during the run. Nothing more is checked. */
  state: 'pending' | 'delivered' | 'failed';
  metrics?: DeliveryMetrics;
  httpStatus?: number;
  /**
   * Why the frame was not delivered. It starts with "Cloudinary: " only when the words are Cloudinary's own
   * (X-Cld-Error); otherwise it is VisualOps' description (still rendering, timeout, network). Absent when the
   * HTTP status is all there is to say.
   */
  reason?: string;
  /**
   * Cloudinary's automatic face detections on this frame (fl_getinfo, percent boxes over the frame), the
   * detector e_pixelate_faces uses. 'error' when fl_getinfo failed; absent while the run is in flight.
   */
  faces?: Region[] | 'error';
}

export interface Tally {
  total: number;
  done: number;
  failed: number;
}

export interface CollectResult {
  assets: number;
  photos: number;
  videos: number;
  sites: string[];
}

export interface AnalyzeResult {
  findings: number;
  /** Status 'open' — the console's meaning of "open". */
  open: number;
  monitoring: number;
  /** Not yet resolved: open + monitoring. */
  unresolved: number;
  counts: Record<Severity, number>;
}

export interface PackageResult {
  schema: string;
  jsonBytes: number;
  hash: string;
}

export interface ReportRun {
  id: number;
  key: string;
  kind: ReportKind;
  scopeLabel: string;
  phase: 'running' | 'ready' | 'failed';
  /** performance.now() at start / finish (wall clock, includes presentational holds). */
  startedAt: number;
  finishedAt?: number;
  stages: Record<StageId, StageRun>;
  collect?: CollectResult;
  analyze?: AnalyzeResult;
  evidence: EvidenceProbe[];
  evidenceBytes: number;
  /** Media analysis only: served renditions measured. */
  delivery?: Tally;
  /** fl_getinfo reads: every asset for media analysis, each evidence frame's asset otherwise. */
  signals?: Tally;
  pkg?: PackageResult;
  error?: string;
}

/** A finished, frozen report. Everything the document and the exports show comes from here. */
export interface ReportSnapshot {
  runId: number;
  key: string;
  model: ReportModel;
  payload: ReportPayload;
  /** The exact JSON text that was hashed — the JSON export downloads these bytes. */
  json: string;
  jsonBytes: number;
  hash: string;
  evidence: EvidenceProbe[];
  evidenceBytes: number;
  delivery: Record<string, DeliveryMetrics | undefined>;
  /** fl_getinfo results by asset id: every asset for media analysis, the evidence frames' assets otherwise. */
  insights: Record<string, CloudinaryInsight | 'error' | undefined>;
  stageMs: Record<StageId, number>;
  /** Sum of the real stage work times. */
  workMs: number;
}

export interface JobState {
  run: ReportRun | null;
  report: ReportSnapshot | null;
}

/* ------------------------------------------------------------------------ */
/* External store                                                            */
/* ------------------------------------------------------------------------ */

let state: JobState = { run: null, report: null };
const listeners = new Set<() => void>();

const notify = () => listeners.forEach((listener) => listener());

/**
 * The state changes at once (the job reads it back synchronously); subscribers hear about it at most once per
 * frame, in the shared notification flush, so a burst of probe responses renders the view once, not once each.
 */
function commit(next: JobState): void {
  state = next;
  schedulePerFrame(notify);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getState = (): JobState => state;

export function useReportJob(): JobState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Applies `fn` to the run only if it is still the current one. */
function update(id: number, fn: (run: ReportRun) => ReportRun): boolean {
  const run = state.run;
  if (!run || run.id !== id) return false;
  commit({ ...state, run: fn(run) });
  return true;
}

/* ------------------------------------------------------------------------ */
/* Scope identity, hand-offs, reveal bookkeeping                             */
/* ------------------------------------------------------------------------ */

/**
 * Identity of "what a report would contain": template, every scope control and
 * the resolved asset and finding set. A report whose key differs from the
 * current one is superseded — its hash is never presented as current.
 */
export function scopeKey(kind: ReportKind, scope: ReportScope, preview: ReportModel): string {
  return JSON.stringify([
    kind,
    [...scope.sites].sort(),
    scope.minSeverity,
    [...scope.statuses].sort(),
    scope.windowDays,
    scope.assetIds,
    scope.redactFaces,
    preview.assets.map((a) => a.id),
    preview.records.map((r) => `${r.finding.id}:${r.finding.severity}:${r.finding.status}`),
  ]);
}

const handoffs = new WeakSet<string[]>();

/** True the first time a hand-off selection (from search or incidents) is seen. */
export function claimHandoff(ids: string[]): boolean {
  if (handoffs.has(ids)) return false;
  handoffs.add(ids);
  return true;
}

const revealed = new Set<number>();
export const wasRevealed = (runId: number): boolean => revealed.has(runId);
export function markRevealed(runId: number): void {
  revealed.add(runId);
}

const focused = new Set<number>();
/** True the first time a finished run's receipt asks to take focus; false for that run ever after. */
export function claimReceiptFocus(runId: number): boolean {
  if (focused.has(runId)) return false;
  focused.add(runId);
  return true;
}

/* ------------------------------------------------------------------------ */
/* The job                                                                   */
/* ------------------------------------------------------------------------ */

export interface GenerateInput {
  kind: ReportKind;
  scope: ReportScope;
  assets: MediaAsset[];
  /** Console clock used for scoping ("last 7 days"), identical to the rest of the console. */
  now: number;
  key: string;
  /** Human-readable scope of this run (shown while it compiles). */
  scopeLabel: string;
  /** STAGE_PACING_MS normally, 0 under reduced motion. */
  pacingMs: number;
}

class Superseded extends Error {}

const clock = (): number => performance.now();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function withDeadline<T>(promise: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const timedOut = (): ProbeResult => ({ kind: 'network', message: `No answer within ${PROBE_TIMEOUT_MS / 1000} s` });

function toEvidence(item: EvidenceProbe, result: ProbeResult): EvidenceProbe {
  switch (result.kind) {
    case 'ready':
      return { ...item, state: 'delivered', metrics: result.metrics, httpStatus: result.metrics.status };
    case 'processing':
      return { ...item, state: 'failed', httpStatus: result.status, reason: 'Still rendering on Cloudinary' };
    case 'error':
      // Quote Cloudinary only when it said something (X-Cld-Error); otherwise the HTTP status is the whole story.
      return {
        ...item,
        state: 'failed',
        httpStatus: result.status,
        reason: result.source === 'x-cld-error' ? `Cloudinary: ${result.message}` : undefined,
      };
    default:
      return { ...item, state: 'failed', reason: result.message };
  }
}

const facesOf = (insight: CloudinaryInsight | 'error' | undefined): Region[] | 'error' =>
  insight && insight !== 'error' ? insight.faces : 'error';

const PENDING: Record<StageId, StageRun> = {
  collect: { status: 'pending' },
  analyze: { status: 'pending' },
  attach: { status: 'pending' },
  package: { status: 'pending' },
};

/**
 * Runs the report sequence. Starting a new run supersedes one in flight (its
 * late results are ignored); probes already sent still land in the shared
 * measurement registry.
 */
export async function generateReport(input: GenerateInput): Promise<void> {
  const id = (state.run?.id ?? 0) + 1;
  const media = input.kind === 'media';
  commit({
    ...state,
    run: {
      id,
      key: input.key,
      kind: input.kind,
      scopeLabel: input.scopeLabel,
      phase: 'running',
      startedAt: clock(),
      stages: PENDING,
      evidence: [],
      evidenceBytes: 0,
    },
  });

  const guard = () => {
    if (state.run?.id !== id) throw new Superseded();
  };
  const begin = (stage: StageId): number => {
    update(id, (r) => ({ ...r, stages: { ...r.stages, [stage]: { status: 'active' } } }));
    return clock();
  };
  const finish = (stage: StageId, startedAt: number, patch: Partial<ReportRun> = {}, status: StageStatus = 'done'): number => {
    const ms = clock() - startedAt;
    update(id, (r) => ({ ...r, ...patch, stages: { ...r.stages, [stage]: { status, ms } } }));
    return ms;
  };
  const hold = async (workMs: number) => {
    if (input.pacingMs > workMs) await wait(input.pacingMs - workMs);
    guard();
  };

  try {
    /* 01 · Collecting media --------------------------------------------- */
    let t = begin('collect');
    const inScope = scopeAssets(input.assets, input.scope, input.now);
    const photos = inScope.filter((a) => a.resourceType === 'image').length;
    await hold(
      finish('collect', t, {
        collect: {
          assets: inScope.length,
          photos,
          videos: inScope.length - photos,
          sites: Array.from(new Set(inScope.map((a) => a.site))).sort(),
        },
      }),
    );

    /* 02 · Analyzing findings ------------------------------------------- */
    t = begin('analyze');
    const built = buildReport(input.kind, input.assets, input.scope, input.now);
    // Scoping uses the console clock; the document records when it was actually generated.
    const model: ReportModel = { ...built, generatedAt: new Date().toISOString() };
    await hold(
      finish('analyze', t, {
        analyze: {
          findings: model.records.length,
          open: model.open,
          monitoring: model.unresolved - model.open,
          unresolved: model.unresolved,
          counts: model.counts,
        },
      }),
    );

    /* 03 · Attaching evidence ------------------------------------------- */
    t = begin('attach');
    const evidence: EvidenceProbe[] = model.records.map(({ finding, asset }, index) => ({
      fig: index + 1,
      assetId: asset.id,
      findingId: finding.id,
      url: evidenceStillUrl(asset, input.scope.redactFaces, EVIDENCE_WIDTH),
      state: 'pending',
    }));
    // Cloudinary's face detections (fl_getinfo, cached per asset) for every evidence frame, so the document can
    // state what e_pixelate_faces actually pixelated. Media analysis reads them for every asset.
    const insightAssets = media
      ? model.assets
      : Array.from(new Map(model.records.map((r) => [r.asset.id, r.asset] as const)).values());
    const tally = (total: number): Tally => ({ total, done: 0, failed: 0 });
    update(id, (r) => ({
      ...r,
      evidence,
      delivery: media ? tally(model.assets.length) : undefined,
      signals: insightAssets.length ? tally(insightAssets.length) : undefined,
    }));

    const results = evidence.slice();
    const delivery: Record<string, DeliveryMetrics | undefined> = {};
    const insights: Record<string, CloudinaryInsight | 'error' | undefined> = {};

    const evidenceProbes = evidence.map(async (item, index) => {
      const result = await withDeadline(
        measure(item.url, { accept: IMAGE_ACCEPT, force: true, timeoutMs: PROBE_TIMEOUT_MS }),
        PROBE_TIMEOUT_MS,
        timedOut,
      );
      const next = toEvidence(item, result);
      results[index] = next;
      update(id, (r) => {
        const list = r.evidence.slice();
        list[index] = next;
        return { ...r, evidence: list, evidenceBytes: r.evidenceBytes + (next.metrics?.bytes ?? 0) };
      });
    });

    // The media analysis report carries measured delivery for the rendition the console serves, and Cloudinary's AI signals.
    const deliveryProbes = media
      ? model.assets.map(async (asset) => {
          const result = await withDeadline(
            measure(servedUrl(asset), {
              accept: asset.resourceType === 'image' ? IMAGE_ACCEPT : undefined,
              force: true,
              timeoutMs: PROBE_TIMEOUT_MS,
            }),
            PROBE_TIMEOUT_MS,
            timedOut,
          );
          const ok = result.kind === 'ready';
          if (result.kind === 'ready') delivery[asset.id] = result.metrics;
          update(id, (r) =>
            r.delivery ? { ...r, delivery: { ...r.delivery, done: r.delivery.done + 1, failed: r.delivery.failed + (ok ? 0 : 1) } } : r,
          );
        })
      : [];

    const signalReads = insightAssets.map(async (asset) => {
      let insight: CloudinaryInsight | 'error';
      try {
        insight = await withDeadline<CloudinaryInsight | 'error'>(fetchInsight(asset), PROBE_TIMEOUT_MS, () => 'error');
      } catch {
        insight = 'error';
      }
      insights[asset.id] = insight;
      const ok = insight !== 'error';
      update(id, (r) =>
        r.signals ? { ...r, signals: { ...r.signals, done: r.signals.done + 1, failed: r.signals.failed + (ok ? 0 : 1) } } : r,
      );
    });

    await Promise.all([...evidenceProbes, ...deliveryProbes, ...signalReads]);
    guard();
    for (let i = 0; i < results.length; i += 1) results[i] = { ...results[i], faces: facesOf(insights[results[i].assetId]) };
    const undelivered = results.some((e) => e.state !== 'delivered');
    await hold(finish('attach', t, { evidence: results.slice() }, undelivered ? 'warn' : 'done'));

    /* 04 · Building audit package --------------------------------------- */
    t = begin('package');
    const payload = reportPayload(model, media ? delivery : {});
    const json = JSON.stringify(payload, null, 2);
    const hash = await sha256Hex(json);
    guard();
    const jsonBytes = new TextEncoder().encode(json).length;
    await hold(finish('package', t, { pkg: { schema: payload.schema, jsonBytes, hash } }));

    /* Report ready ------------------------------------------------------- */
    const run = state.run;
    if (!run || run.id !== id) return;
    const stageMs = {
      collect: run.stages.collect.ms ?? 0,
      analyze: run.stages.analyze.ms ?? 0,
      attach: run.stages.attach.ms ?? 0,
      package: run.stages.package.ms ?? 0,
    };
    commit({
      run: { ...run, phase: 'ready', finishedAt: clock() },
      report: {
        runId: id,
        key: input.key,
        model,
        payload,
        json,
        jsonBytes,
        hash,
        evidence: results,
        evidenceBytes: results.reduce((sum, e) => sum + (e.metrics?.bytes ?? 0), 0),
        delivery,
        insights,
        stageMs,
        workMs: stageMs.collect + stageMs.analyze + stageMs.attach + stageMs.package,
      },
    });
  } catch (error) {
    if (error instanceof Superseded) return;
    update(id, (r) => ({
      ...r,
      phase: 'failed',
      finishedAt: clock(),
      error: (error as Error)?.message || 'Report generation failed',
    }));
  }
}
