import type { AiUnderstanding, MediaAsset } from '@/lib/types';
import { DEMO_CLOUD } from '@/lib/cloudinary/config';
import { analyzeAsset, findCloudAsset, type AnalyzeResult, type CloudResource } from '@/lib/cloudinary/backend';
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
import { formatBytes, formatDateTime, formatMs, pluralize } from '@/lib/format';
import { deriveTags, searchableTerms, verifyRetrieval, type DerivedTag, type TagSource } from './signals';

/**
 * The pipeline machine's runner. Every stage is a real operation:
 *
 *   INGEST      HEAD the stored original on Cloudinary (the team's cloud, or the demo cloud for samples)
 *   UNDERSTAND  Cloudinary AI. For the team's photos: the AI understanding stored on the asset, or —
 *               when there is none yet — POST /api/assets/[id]/analyze (captioning + coco_v2 object
 *               detection with auto-tagging, 2 detections). For every asset: fl_getinfo (face
 *               detections, where g_auto places a 1:1 crop; the poster frame for video).
 *   CLASSIFY    local: the human classification and the AI tags, each labelled with its source
 *   TRANSFORM   HEAD the pipeline URL; polls through HTTP 423 (async AI)
 *   OPTIMIZE    local: delivered vs original, from TRANSFORM's Server-Timing
 *   INDEX       the team's records: GET /api/assets?public_id=… proves the record is in Cloudinary's
 *               Search index; every record: the console's own search, run over the real record set
 *
 * Latencies are measured around each operation only. Between stages the
 * runner pauses for `pace` (≤ 220 ms) while the hand-off packet travels; that
 * pause is presentational, happens outside every stage and is never counted.
 *
 * Request counts are the requests this run sent. A session-cached fl_getinfo
 * answer, a stored AI understanding, or a probe another view already had in
 * flight for the same URL is reported as such and not counted.
 */

export type StageId = 'ingest' | 'understand' | 'classify' | 'transform' | 'optimize' | 'index';
export type StageStatus = 'idle' | 'processing' | 'success' | 'warning' | 'error';

export interface StageDef {
  id: StageId;
  name: string;
  /** What the stage will do, shown before the first run. */
  plan: string;
  planDetail: string;
  /** Runs in this browser without a network request. */
  local: boolean;
}

export const STAGE_IDS: StageId[] = ['ingest', 'understand', 'classify', 'transform', 'optimize', 'index'];

/** Where the record lives, which decides what UNDERSTAND and INDEX can do. */
export interface MachineScope {
  /** The record lives in the team's Cloudinary cloud, which the VisualOps server is connected to. */
  team: boolean;
  resourceType: MediaAsset['resourceType'];
  /** The record already carries Cloudinary AI understanding (no detections are spent). */
  analysed: boolean;
}

/** The six stages as they will run for this record. */
export function stagesFor(scope: MachineScope): StageDef[] {
  const image = scope.resourceType === 'image';
  const understand: Pick<StageDef, 'plan' | 'planDetail'> = !scope.team
    ? { plan: 'Cloudinary AI face + crop signals', planDetail: 'fl_getinfo · AI Content Analysis runs on the team cloud' }
    : !image
      ? { plan: 'Cloudinary AI on the poster frame', planDetail: 'fl_getinfo · caption + objects run on images' }
      : scope.analysed
        ? { plan: 'Cloudinary AI caption + objects', planDetail: 'stored on the asset · fl_getinfo' }
        : { plan: 'Cloudinary AI caption + objects', planDetail: 'POST /analyze · 2 detections · fl_getinfo' };
  return [
    {
      id: 'ingest',
      name: 'Ingest',
      plan: scope.team ? 'Verify the stored original' : 'Verify the sample original',
      planDetail: scope.team ? 'HEAD · team cloud' : 'HEAD · Cloudinary demo cloud',
      local: false,
    },
    { id: 'understand', name: 'Understand', ...understand, local: false },
    { id: 'classify', name: 'Classify', plan: 'Human classification + AI tags', planDetail: 'local · every label with its source', local: true },
    { id: 'transform', name: 'Transform', plan: 'Render the pipeline URL', planDetail: 'HEAD · polls through 423', local: false },
    { id: 'optimize', name: 'Optimize', plan: 'Delivered vs original', planDetail: 'Server-Timing · content-info', local: true },
    scope.team
      ? { id: 'index', name: 'Index', plan: 'Cloudinary Search index', planDetail: 'Search API lookup · console search', local: false }
      : { id: 'index', name: 'Index', plan: 'Console search', planDetail: 'local · sample workspace index', local: true },
  ];
}

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
  /** A problem worth attention (warn / error colour). */
  message?: string;
  /** Neutral context, e.g. why a step does not apply to this record. */
  note?: string;
  tags?: DerivedTag[];
  /** Cloudinary AI understanding shown by UNDERSTAND (always labelled AI detected). */
  ai?: { caption?: string; objects: string[]; origin: 'stored' | 'analysed' | 'server-cached' };
  /** Requests this stage sent (joined or cached answers are not counted). */
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
  /** The record lives in the team's cloud (the VisualOps server can analyse it and look it up). */
  team: boolean;
  /** Called with the record once UNDERSTAND has stored new AI understanding on it. */
  onAnalysed?: (asset: MediaAsset) => void;
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
const statusOf = (error: unknown) => {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' && status > 0 ? String(status) : 'ERR';
};
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

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

/** The asset's AI understanding when it carries any (a stored result, not a fresh one). */
function storedAi(asset: MediaAsset): AiUnderstanding | undefined {
  const ai = asset.ai;
  return ai && (ai.caption || ai.objects.length || ai.tags.length || ai.analyzedAt) ? ai : undefined;
}

function aiView(ai: AiUnderstanding, origin: NonNullable<StageState['ai']>['origin']): StageState['ai'] {
  return {
    caption: ai.caption,
    objects: ai.objects.map((o) => `${o.label} ${Math.round(o.confidence * 100)}%`),
    origin,
  };
}

const SOURCE_WORD: Record<TagSource, string> = { human: 'human classified', ai: 'AI detected', system: 'system derived' };

export async function runMachine(input: MachineInput, io: MachineIO): Promise<RunOutcome | null> {
  const { steps, team } = input;
  let asset = input.asset;
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

  /* 1 · INGEST — the stored original, straight from Cloudinary. */
  const sourceUrl = originalUrl(asset);
  const up = await settle(begin('ingest'), probeUrl(sourceUrl, { accept, signal }));
  if (signal.aborted || (!up.ok && isAbort(up.error))) return null;
  const stored: { format?: string; bytes?: number; width?: number; height?: number } = {};
  const where = team
    ? `${asset.cloudName}/${asset.resourceType}/upload/${asset.publicId}`
    : asset.cloudName === DEMO_CLOUD
      ? `demo cloud · ${asset.publicId}`
      : `${asset.cloudName} · ${asset.publicId}`;
  if (!up.ok) {
    finish('ingest', up.ms, { status: 'error', code: 'ERR', result: 'Probe failed', message: messageOf(up.error) });
    return halt('ingest');
  }
  const ingest = up.value;
  if (ingest.kind === 'ready') {
    const m = ingest.metrics;
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
    finish('ingest', up.ms, {
      status: 'success',
      code: String(m.status),
      result: dot(upper(stored.format), stored.bytes !== undefined && formatBytes(stored.bytes), dims(stored.width, stored.height)) || 'Original reachable',
      detail: dot(
        `HEAD ${m.status}`,
        m.cache && `CDN ${m.cache}`,
        !isImage && m.format && `plays as ${upper(m.format)} ${formatBytes(m.bytes)}`,
        !isImage && m.originalDuration !== undefined && `${seconds(m.originalDuration)} stored`,
        where,
      ),
      requests: 1,
    });
  } else if (ingest.kind === 'processing') {
    pushActivity('processing', sourceUrl, 'HTTP 423 · Cloudinary rendering asynchronously');
    finish('ingest', up.ms, {
      status: 'warning',
      code: '423',
      result: 'Stored · playback rendition still rendering',
      detail: dot('HEAD 423', where),
      message: cloudinarySays(ingest),
      requests: 1,
    });
  } else {
    pushActivity('error', sourceUrl, ingest.kind === 'network' ? ingest.message : dot(`HTTP ${ingest.status}`, cloudinarySays(ingest)));
    finish('ingest', up.ms, { ...failure(ingest), detail: where, requests: ingest.kind === 'network' ? 0 : 1 });
    return halt('ingest');
  }

  /* 2 · UNDERSTAND — Cloudinary AI. Non-blocking: CLASSIFY can proceed from the record alone. */
  if (!(await handoff('understand'))) return null;
  const understandStarted = begin('understand');
  const already = storedAi(asset);
  // fetchInsight memoises per session: a cached answer never leaves the browser, so it is not a request of this run.
  const insightFromCache = insightCached(asset);
  const insightWork = settle(understandStarted, fetchInsight(asset));
  // AI Content Analysis: the team's photos only, and only when no understanding is stored yet (2 detections).
  const analyse = team && isImage && !already;
  const analyseWork: Promise<Settled<AnalyzeResult> | null> = analyse
    ? settle(clock(), analyzeAsset(asset.publicId, 'image', { signal }))
    : Promise.resolve(null);
  const [an, az] = await Promise.all([insightWork, analyseWork]);
  if (signal.aborted) return null;
  const understandMs = clock() - understandStarted;

  let insight: CloudinaryInsight | undefined;
  if (an.ok) insight = an.value;
  let ai = already;
  let aiOrigin: NonNullable<StageState['ai']>['origin'] | undefined = already ? 'stored' : undefined;
  let aiProblem: string | undefined;
  let aiCode: string | undefined;
  if (az) {
    if (az.ok) {
      ai = az.value.ai;
      aiOrigin = az.value.cached ? 'server-cached' : 'analysed';
      aiProblem = az.value.warning;
      asset = { ...asset, ai: az.value.ai };
      input.onAnalysed?.(asset);
    } else if (!isAbort(az.error)) {
      aiProblem = `AI analysis failed — ${messageOf(az.error)}`;
      aiCode = statusOf(az.error);
    }
  }

  const signalsText = insight
    ? dot(faceDetections(insight.faces.length), insight.focus ? `g_auto crop ${describeCropCentre(insight.focus)}` : 'no g_auto crop reported')
    : undefined;
  const aiSource =
    aiOrigin === 'stored'
      ? dot('AI understanding stored on the asset', ai?.analyzedAt && `analysed ${formatDateTime(ai.analyzedAt)}`)
      : aiOrigin === 'analysed'
        ? `POST /analyze ${formatMs(az?.ms)} · 2 detections`
        : aiOrigin === 'server-cached'
          ? 'stored result returned by the server · no detections spent'
          : undefined;
  const aiRequests = az ? 1 : 0;
  const insightRequests = an.ok && insightFromCache ? 0 : 1;
  const note = !team
    ? 'Sample on Cloudinary’s demo cloud: AI Content Analysis (caption, objects) runs on the team’s own cloud; fl_getinfo runs here.'
    : !isImage
      ? 'Video: caption and object detection run on images; the poster frame keeps fl_getinfo face and crop signals.'
      : undefined;
  const understandProblems = [aiProblem, !an.ok && `fl_getinfo failed — ${messageOf(an.error)}`].filter(Boolean).join('. ') || undefined;
  if (!ai && !insight) {
    finish('understand', understandMs, {
      status: 'error',
      code: aiCode ?? 'ERR',
      result: 'No AI signals · continuing with the record',
      detail: dot(analyse && 'POST /analyze', 'fl_getinfo'),
      message: understandProblems,
      note,
      requests: aiRequests + insightRequests,
    });
  } else {
    finish('understand', understandMs, {
      status: understandProblems ? 'warning' : 'success',
      code: aiCode ?? (aiOrigin === 'analysed' ? '200' : insightFromCache && !az ? 'cached' : '200'),
      result: ai?.caption ? `“${clip(ai.caption, 90)}”` : (signalsText ?? 'AI signals received'),
      detail: dot(aiSource, ai?.model, insight && dot('fl_getinfo', insightFromCache && 'session cache'), ai?.caption && signalsText),
      message: understandProblems,
      note,
      ai: ai ? aiView(ai, aiOrigin ?? 'stored') : undefined,
      requests: aiRequests + insightRequests,
    });
  }

  /* 3 · CLASSIFY — local: the human classification and the AI tags, each with its source. */
  if (!(await handoff('classify'))) return null;
  begin('classify');
  const cl = local(() => deriveTags(asset, { insight, ai, storedFormat: stored.format, integrity }));
  const bySource = (source: TagSource) => cl.value.filter((t) => t.source === source).length;
  const counts = (['human', 'ai', 'system'] as TagSource[]).map((s) => [s, bySource(s)] as const).filter(([, n]) => n > 0);
  finish('classify', cl.ms, {
    status: 'success',
    result: pluralize(cl.value.length, 'label'),
    detail: counts.map(([s, n]) => `${n} ${SOURCE_WORD[s]}`).join(' · '),
    tags: cl.value,
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
  const inFlight = getMeasurement(url);
  if (joined && inFlight?.kind === 'processing') flagRendering(inFlight);
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
    // Face redaction only changes frames where Cloudinary detects a face; UNDERSTAND just asked the same detector.
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

  /* 6 · INDEX — Cloudinary's Search index (the team's records), then the console's own search. */
  if (!(await handoff('index'))) return null;
  const indexStarted = begin('index');
  let lookup: Settled<CloudResource | null> | null = null;
  if (team) lookup = await settle(indexStarted, findCloudAsset(asset.publicId, signal));
  if (signal.aborted) return null;
  const ix = local(() => ({ terms: searchableTerms(asset), check: verifyRetrieval(asset, input.assets, input.now) }));
  const indexMs = clock() - indexStarted;
  const { terms, check } = ix.value;
  const retrievable = check.rank !== null;
  const termsText = dot(pluralize(terms.human, 'record term'), terms.ai > 0 && `${terms.ai} from Cloudinary AI`);
  const rankText = retrievable ? `console search “${check.query}” → #${check.rank} of ${check.total}` : `console search “${check.query}” → not returned`;
  const indexProblems: string[] = [];
  let result: string;
  let code: string | undefined;
  let lookupDetail: string | undefined;
  if (lookup) {
    if (lookup.ok && lookup.value) {
      const ctx = lookup.value.context ?? {};
      result = 'In Cloudinary’s Search index';
      code = '200';
      lookupDetail = dot(`Search API ${formatMs(lookup.ms)}`, `${pluralize(Object.keys(ctx).length, 'context key')}`, ctx.ai_caption && 'AI caption indexed');
    } else if (lookup.ok) {
      result = 'Not in the Search index yet';
      code = '200';
      lookupDetail = `Search API ${formatMs(lookup.ms)} · no match for this public_id`;
      indexProblems.push('Cloudinary’s Search index can lag a few seconds behind an upload or a tag change — run again shortly');
    } else {
      result = 'Search index lookup failed';
      code = statusOf(lookup.error);
      lookupDetail = `Search API ${formatMs(lookup.ms)}`;
      indexProblems.push(messageOf(lookup.error));
    }
  } else {
    result = termsText;
  }
  if (!retrievable) indexProblems.push('Not retrievable by its own descriptors');
  if (generative) indexProblems.push(GENERATIVE_WARNING);
  finish('index', indexMs, {
    status: indexProblems.length ? 'warning' : 'success',
    code,
    result,
    detail: lookup ? dot(lookupDetail, termsText, rankText) : rankText,
    message: indexProblems.join('. ') || undefined,
    note: lookup ? undefined : 'Sample workspace: indexed in this browser; the team’s records are looked up in Cloudinary’s Search index.',
    requests: lookup ? 1 : 0,
  });

  return { kind: 'complete', warnings, totalMs, requests };
}
