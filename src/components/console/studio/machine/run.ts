import type { MediaAsset } from '@/lib/types';
import { originalUrl } from '@/lib/cloudinary/media';
import {
  STEP_DEFINITIONS,
  num,
  pipelineComponents,
  pipelineIntegrity,
  pipelineUrl,
  type PipelineStep,
  type StepKind,
} from '@/lib/cloudinary/pipeline';
import {
  IMAGE_ACCEPT,
  getMeasurement,
  isMeasuring,
  measure,
  probeUrl,
  pushActivity,
  subscribeMeasurements,
  type DeliveryMetrics,
  type ProbeResult,
} from '@/lib/cloudinary/probe';
import {
  describeCropCentre,
  faceDetections,
  fetchInsight,
  insightCached,
  type CloudinaryInsight,
} from '@/lib/cloudinary/insights';
import { formatBytes, formatMs, pluralize } from '@/lib/format';
import { deriveTags, searchableTerms, verifyRetrieval, type DerivedTag } from './signals';

/**
 * The pipeline machine's runner. Every stage is a real operation:
 *
 *   UPLOAD     HEAD the stored original on Cloudinary
 *   ANALYZE    Cloudinary fl_getinfo (face detections, where g_auto places a 1:1 crop)
 *   TAG        local: tags from the record + the Cloudinary signals above
 *   TRANSFORM  HEAD the pipeline URL; polls through HTTP 423 (async AI)
 *   OPTIMIZE   local: delivered vs original, from TRANSFORM's Server-Timing
 *   INDEX      local: the console's search, run over the real record set
 *
 * Latencies are measured around each operation only. Between stages the
 * runner pauses for `pace` (≤ 220 ms) while the hand-off packet travels; that
 * pause is presentational, happens outside every stage and is never counted.
 *
 * Request counts are the requests this run sent. A session-cached fl_getinfo
 * answer, or a probe another view already had in flight for the same URL, is
 * reported as such and not counted.
 */

export type StageId = 'upload' | 'analyze' | 'tag' | 'transform' | 'optimize' | 'index';
export type StageStatus = 'idle' | 'processing' | 'success' | 'warning' | 'error';

export interface StageDef {
  id: StageId;
  name: string;
  /** What the stage will do, shown before the first run. */
  plan: string;
  planDetail: string;
  local: boolean;
}

export const STAGES: StageDef[] = [
  { id: 'upload', name: 'Upload', plan: 'Verify the stored original', planDetail: 'HEAD · original asset', local: false },
  { id: 'analyze', name: 'Analyze', plan: 'Cloudinary AI signals', planDetail: 'fl_getinfo · faces · g_auto crop', local: false },
  { id: 'tag', name: 'Tag', plan: 'Record + AI signal tags', planDetail: 'local · no network', local: true },
  { id: 'transform', name: 'Transform', plan: 'Render the pipeline URL', planDetail: 'HEAD · polls through 423', local: false },
  { id: 'optimize', name: 'Optimize', plan: 'Delivered vs original', planDetail: 'Server-Timing · content-info', local: true },
  { id: 'index', name: 'Index', plan: 'Console search', planDetail: 'local · retrieval check', local: true },
];

export const STAGE_IDS: StageId[] = STAGES.map((s) => s.id);

export interface StageState {
  status: StageStatus;
  /** True while the operation is in flight (including 423 polling). */
  live: boolean;
  /** performance.now() when the stage started. */
  startedAt?: number;
  /** Measured duration of the operation itself (pacing excluded). */
  ms?: number;
  /** HTTP status or short code shown next to the state. */
  code?: string;
  /** Short lead figure, e.g. "−87%". Coloured by the stage status. */
  emphasis?: string;
  result?: string;
  detail?: string;
  message?: string;
  tags?: DerivedTag[];
  /** Requests this stage sent to Cloudinary (joined or cached answers are not counted). */
  requests?: number;
  /** Not run because an upstream stage failed. */
  halted?: boolean;
  /** The upstream stage has handed off to this one (the packet is travelling). */
  incoming?: boolean;
}

export type RunOutcome =
  | { kind: 'complete'; warnings: number; totalMs: number; requests: number }
  | { kind: 'halted'; at: StageId; totalMs: number; requests: number };

export interface MachineInput {
  asset: MediaAsset;
  steps: PipelineStep[];
  assets: MediaAsset[];
  now: number;
}

export interface MachineIO {
  update: (id: StageId, patch: Partial<StageState>) => void;
  signal: AbortSignal;
  /** Presentational pause between stages in ms (0 under reduced motion). */
  pace: number;
}

export const GENERATIVE_WARNING = 'Generative output — not evidence';

const clock = () => performance.now();

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });

type Settled<T> = { ok: true; value: T; ms: number } | { ok: false; error: unknown; ms: number };

/** Awaits `work`, timing it from `started`. Never rejects. */
function settle<T>(started: number, work: Promise<T>): Promise<Settled<T>> {
  return work.then(
    (value): Settled<T> => ({ ok: true, value, ms: clock() - started }),
    (error: unknown): Settled<T> => ({ ok: false, error, ms: clock() - started }),
  );
}

/** Runs a synchronous local operation and times it precisely. */
function local<T>(fn: () => T): { value: T; ms: number } {
  const t0 = clock();
  const value = fn();
  return { value, ms: clock() - t0 };
}

const dot = (...parts: Array<string | false | undefined | null>) => parts.filter(Boolean).join(' · ');
const dims = (w?: number, h?: number) => (w && h ? `${w}×${h}` : undefined);
const upper = (s?: string) => s?.toUpperCase();
const seconds = (s: number) => `${Number(s.toFixed(1))} s`;
const isAbort = (error: unknown) => (error as Error)?.name === 'AbortError';
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Cloudinary's own explanation of a 423 / error, or nothing. Without an
 * `X-Cld-Error` header the probe's message is VisualOps' fallback wording (it
 * only repeats the status line), so it is never shown as Cloudinary's.
 */
function cloudinarySays(result: Extract<ProbeResult, { kind: 'error' } | { kind: 'processing' }>): string | undefined {
  return result.source === 'x-cld-error' ? result.message : undefined;
}

function failure(result: Exclude<ProbeResult, { kind: 'ready' } | { kind: 'processing' }>): Partial<StageState> {
  return result.kind === 'network'
    ? { status: 'error', code: 'NET', result: 'Could not reach Cloudinary', message: result.message }
    : { status: 'error', code: String(result.status), result: `Cloudinary answered HTTP ${result.status}`, message: cloudinarySays(result) };
}

/** Enabled steps of `kind` that apply to the asset's resource type. */
function activeSteps(steps: PipelineStep[], asset: MediaAsset, kind: StepKind): PipelineStep[] {
  return steps.filter((s) => s.enabled && s.kind === kind && STEP_DEFINITIONS[kind].appliesTo.includes(asset.resourceType));
}

/**
 * Steps that shorten a clip, so a smaller delivered file is not read as pure
 * compression: "includes trim to 8 s of 32 s". Prefers the durations Cloudinary
 * reported (`du` / `odu`) over the step parameters.
 */
function durationNote(steps: PipelineStep[], asset: MediaAsset, m: DeliveryMetrics): string | undefined {
  const of = m.originalDuration !== undefined ? ` of ${seconds(m.originalDuration)}` : '';
  const trim = activeSteps(steps, asset, 'trim')[0];
  if (trim) return `includes trim to ${seconds(m.duration ?? num(trim.params.duration, 8, 1, 120))}${of}`;
  const highlights = activeSteps(steps, asset, 'ai_preview')[0];
  if (highlights) return `includes AI highlights cut to ${seconds(m.duration ?? num(highlights.params.duration, 6, 2, 30))}${of}`;
  return undefined;
}

/** Why the delivered file is heavier than the stored original — only what the measurements show. */
function largerReason(
  original: { width?: number; height?: number; format?: string },
  m: DeliveryMetrics,
  generative: boolean,
): string {
  const inPx = (original.width ?? 0) * (original.height ?? 0);
  const outPx = (m.width ?? 0) * (m.height ?? 0);
  const size = dims(original.width, original.height) && dims(m.width, m.height) ? `${dims(original.width, original.height)} → ${dims(m.width, m.height)}` : undefined;
  if (inPx > 0 && outPx > inPx * 1.01) return `upscaled ${size}`;
  if (generative) return dot('generated pixels', size);
  const formats = original.format && m.format && original.format !== m.format ? `${upper(original.format)} → ${upper(m.format)}` : undefined;
  return dot(size, formats) || 'same frame, more bytes';
}

export async function runMachine(input: MachineInput, io: MachineIO): Promise<RunOutcome | null> {
  const { asset, steps } = input;
  const { signal, pace, update } = io;
  const isImage = asset.resourceType === 'image';
  const accept = isImage ? IMAGE_ACCEPT : undefined;
  const integrity = pipelineIntegrity(steps, asset);
  const generative = integrity === 'generative';

  let totalMs = 0;
  let requests = 0;
  let warnings = 0;

  const begin = (id: StageId) => {
    const startedAt = clock();
    update(id, { status: 'processing', live: true, startedAt });
    return startedAt;
  };
  const finish = (id: StageId, ms: number, patch: Partial<StageState>) => {
    totalMs += ms;
    requests += patch.requests ?? 0;
    if (patch.status === 'warning') warnings += 1;
    update(id, { live: false, ms, ...patch });
  };
  /** Packet hand-off to the next stage: presentational, outside every stage's timing. */
  const handoff = async (to: StageId) => {
    update(to, { incoming: true });
    await sleep(pace, signal);
    return !signal.aborted;
  };
  const halt = (at: StageId): RunOutcome => {
    STAGE_IDS.slice(STAGE_IDS.indexOf(at) + 1).forEach((id) => update(id, { halted: true }));
    return { kind: 'halted', at, totalMs, requests };
  };

  /* 1 · UPLOAD — the stored original, straight from Cloudinary. */
  const sourceUrl = originalUrl(asset);
  const up = await settle(begin('upload'), probeUrl(sourceUrl, { accept, signal }));
  if (signal.aborted || (!up.ok && isAbort(up.error))) return null;
  const stored: { format?: string; bytes?: number; width?: number; height?: number } = {};
  if (!up.ok) {
    finish('upload', up.ms, { status: 'error', code: 'ERR', result: 'Probe failed', message: messageOf(up.error) });
    return halt('upload');
  }
  const upload = up.value;
  if (upload.kind === 'ready') {
    const m = upload.metrics;
    // For video the playable URL is an MP4 rendition; only content-info's `o*` fields describe the stored file.
    stored.format = m.originalFormat ?? (isImage ? m.format : undefined);
    stored.bytes = m.originalBytes ?? (isImage ? m.bytes : undefined);
    stored.width = m.originalWidth ?? (isImage ? m.width : undefined);
    stored.height = m.originalHeight ?? (isImage ? m.height : undefined);
    pushActivity(
      'delivered',
      sourceUrl,
      `Original verified · ${dot(upper(stored.format ?? m.format), formatBytes(stored.bytes ?? m.bytes))} · CDN ${m.cache ?? 'n/a'} · ${Math.round(m.elapsedMs)} ms`,
      m,
    );
    finish('upload', up.ms, {
      status: 'success',
      code: String(m.status),
      result: dot(upper(stored.format), stored.bytes !== undefined && formatBytes(stored.bytes), dims(stored.width, stored.height)) || 'Original reachable',
      detail: dot(
        `HEAD ${m.status}`,
        m.cache && `CDN ${m.cache}`,
        !isImage && m.format && `plays as ${upper(m.format)} ${formatBytes(m.bytes)}`,
      ),
      requests: 1,
    });
  } else if (upload.kind === 'processing') {
    pushActivity('processing', sourceUrl, 'HTTP 423 · Cloudinary rendering asynchronously');
    finish('upload', up.ms, {
      status: 'warning',
      code: '423',
      result: 'Stored · playback rendition still rendering',
      detail: 'HEAD 423',
      message: cloudinarySays(upload),
      requests: 1,
    });
  } else {
    pushActivity(
      'error',
      sourceUrl,
      upload.kind === 'network' ? upload.message : dot(`HTTP ${upload.status}`, cloudinarySays(upload)),
    );
    finish('upload', up.ms, { ...failure(upload), requests: upload.kind === 'network' ? 0 : 1 });
    return halt('upload');
  }

  /* 2 · ANALYZE — Cloudinary fl_getinfo. Non-blocking: TAG can proceed from the record alone. */
  if (!(await handoff('analyze'))) return null;
  // fetchInsight memoises per session: a cached answer never leaves the browser, so it is not a request of this run.
  const insightFromCache = insightCached(asset);
  const an = await settle(begin('analyze'), fetchInsight(asset));
  if (signal.aborted) return null;
  let insight: CloudinaryInsight | undefined;
  if (an.ok) {
    insight = an.value;
    const focus = insight.focus;
    finish('analyze', an.ms, {
      status: 'success',
      code: insightFromCache ? 'cached' : '200',
      // g_auto_info is the crop window for the requested 1:1 ratio, so only its position is a signal — not a subject size.
      result: dot(faceDetections(insight.faces.length), focus ? `g_auto 1:1 crop ${describeCropCentre(focus)}` : 'no g_auto crop reported'),
      detail: dot(
        'fl_getinfo',
        insightFromCache && 'session cache · no request',
        dims(insight.inputWidth, insight.inputHeight) && `input ${dims(insight.inputWidth, insight.inputHeight)}`,
      ),
      requests: insightFromCache ? 0 : 1,
    });
  } else {
    finish('analyze', an.ms, {
      status: 'error',
      code: 'ERR',
      result: 'fl_getinfo failed · continuing with the record',
      message: messageOf(an.error),
      requests: 1,
    });
  }

  /* 3 · TAG — local. */
  if (!(await handoff('tag'))) return null;
  begin('tag');
  const tg = local(() => deriveTags(asset, { insight, storedFormat: stored.format, integrity }));
  const fromCloudinary = tg.value.filter((t) => t.source === 'cloudinary').length;
  finish('tag', tg.ms, {
    status: 'success',
    result: `${tg.value.length} tags`,
    detail: insight ? `${fromCloudinary} from Cloudinary signals` : 'record only · no Cloudinary signals',
    tags: tg.value,
  });

  /* 4 · TRANSFORM — the pipeline URL, rendered by Cloudinary. */
  const url = pipelineUrl(steps, asset);
  const componentCount = pipelineComponents(steps, asset).length;
  if (!(await handoff('transform'))) return null;
  const transformStarted = begin('transform');
  // Another view (the comparison viewer, the delivery receipt) may already be probing this exact URL:
  // measure() then joins that request instead of sending one, and its responses are not this run's requests.
  const joined = isMeasuring(url);
  let seen = getMeasurement(url);
  let responses = 0;
  let rendering = false;
  const own = () => (joined ? 0 : responses);
  const flagRendering = (result: Extract<ProbeResult, { kind: 'processing' }>) => {
    if (signal.aborted) return;
    rendering = true;
    update('transform', {
      status: 'warning',
      code: '423',
      result: 'Rendering asynchronously (423)',
      detail: joined
        ? dot('joined in-flight polling', responses > 0 && `${pluralize(responses, 'response')} seen`)
        : dot('polling every 2.5 s', responses > 0 && pluralize(responses, 'request')),
      message: cloudinarySays(result),
    });
  };
  const unsubscribe = subscribeMeasurements(() => {
    const r = getMeasurement(url);
    if (r === seen) return;
    seen = r;
    responses += 1;
    if (r?.kind === 'processing') flagRendering(r);
  });
  const pending = measure(url, { accept, force: true });
  const already = getMeasurement(url);
  if (joined && already?.kind === 'processing') flagRendering(already);
  const tr = await settle(transformStarted, pending);
  unsubscribe();
  if (signal.aborted) return null;
  let delivered: DeliveryMetrics | undefined;
  if (!tr.ok) {
    finish('transform', tr.ms, { status: 'error', code: 'ERR', result: 'Probe failed', message: messageOf(tr.error), requests: own() });
    return halt('transform');
  }
  const transform = tr.value;
  if (transform.kind === 'ready') {
    const m = transform.metrics;
    delivered = m;
    // Face redaction only changes frames where Cloudinary detects a face; ANALYZE just asked the same detector.
    const redaction = activeSteps(steps, asset, 'privacy_faces');
    const nothingToRedact = insight !== undefined && insight.faces.length === 0 && redaction.length > 0;
    const redactionComponent = nothingToRedact ? STEP_DEFINITIONS.privacy_faces.build(redaction[0].params, { asset }) : null;
    finish('transform', tr.ms, {
      status: nothingToRedact ? 'warning' : 'success',
      code: String(m.status),
      result: dot(upper(m.format), dims(m.width, m.height), m.bytes !== undefined && formatBytes(m.bytes)) || 'Delivered',
      detail: dot(
        `HEAD ${m.status}`,
        joined
          ? dot('joined in-flight request', rendering && `ready after ${pluralize(responses, 'response')}`)
          : rendering
            ? `ready after ${pluralize(responses, 'request')}`
            : pluralize(componentCount, 'component'),
      ),
      message: nothingToRedact ? `No faces detected — ${redactionComponent ?? 'face redaction'} left the output unchanged` : undefined,
      requests: own(),
    });
  } else if (transform.kind === 'processing') {
    finish('transform', tr.ms, {
      status: 'warning',
      code: '423',
      result: 'Still rendering after 2 min',
      detail: joined ? dot('joined in-flight polling', `${pluralize(responses, 'response')} seen`) : `${pluralize(responses, 'request')} · the viewer keeps polling`,
      message: cloudinarySays(transform),
      requests: own(),
    });
  } else {
    finish('transform', tr.ms, { ...failure(transform), requests: own() });
    return halt('transform');
  }

  /* 5 · OPTIMIZE — local arithmetic on TRANSFORM's Server-Timing. */
  if (!(await handoff('optimize'))) return null;
  begin('optimize');
  const op = local(() => {
    if (!delivered) return null;
    const original = delivered.originalBytes ?? stored.bytes;
    const originalFormat = delivered.originalFormat ?? stored.format;
    const saved = original && delivered.bytes !== undefined ? 1 - delivered.bytes / original : undefined;
    return { original, originalFormat, saved, m: delivered };
  });
  if (!op.value) {
    finish('optimize', op.ms, {
      status: 'warning',
      result: 'No delivery metrics yet',
      detail: 'waiting on TRANSFORM',
      message: generative ? GENERATIVE_WARNING : undefined,
    });
  } else {
    const { original, originalFormat, saved, m } = op.value;
    // Rounded to whole percent: a change that rounds to 0 is neither a saving nor a loss worth flagging.
    const pct = saved !== undefined ? Math.round(saved * 100) : undefined;
    const larger = pct !== undefined && pct < 0;
    const largerMessage = larger
      ? `Output larger than original — ${largerReason(
          {
            width: m.originalWidth ?? stored.width,
            height: m.originalHeight ?? stored.height,
            format: originalFormat,
          },
          m,
          generative,
        )}`
      : undefined;
    finish('optimize', op.ms, {
      status: generative || larger ? 'warning' : 'success',
      emphasis: pct !== undefined ? `${pct > 0 ? '−' : pct < 0 ? '+' : '±'}${Math.abs(pct)}%` : undefined,
      result:
        original !== undefined && m.bytes !== undefined
          ? `${formatBytes(original)} → ${formatBytes(m.bytes)}`
          : m.bytes !== undefined
            ? `${formatBytes(m.bytes)} delivered`
            : 'Size not reported',
      detail: dot(
        durationNote(steps, asset, m),
        originalFormat && m.format && `${upper(originalFormat)} → ${upper(m.format)}`,
        m.cache && `CDN ${m.cache}`,
        m.transformMs !== undefined && `transform ${formatMs(m.transformMs)}`,
      ),
      // The size finding first: the generative label is repeated by the badge and by INDEX.
      message: [largerMessage, generative && GENERATIVE_WARNING].filter(Boolean).join('. ') || undefined,
    });
  }

  /* 6 · INDEX — local: the console's own search over the real record set. */
  if (!(await handoff('index'))) return null;
  begin('index');
  const ix = local(() => ({ terms: searchableTerms(asset), check: verifyRetrieval(asset, input.assets, input.now) }));
  const { terms, check } = ix.value;
  const retrievable = check.rank !== null;
  finish('index', ix.ms, {
    status: generative || !retrievable ? 'warning' : 'success',
    result: `${terms} searchable terms`,
    detail: retrievable ? `“${check.query}” → #${check.rank} of ${check.total}` : `“${check.query}” → not returned`,
    message: generative ? GENERATIVE_WARNING : retrievable ? undefined : 'Not retrievable by its own descriptors',
  });

  return { kind: 'complete', warnings, totalMs, requests };
}
