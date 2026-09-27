/**
 * Live delivery probes.
 *
 * VisualOps never invents delivery numbers. Every size, format, cache status
 * and processing time shown in the UI is read from Cloudinary's own response
 * headers:
 *
 *  - `Server-Timing: content-info;desc="width=…,bytes=…,format=…,obytes=…,oformat=…"`
 *    exposes the delivered and the original byte size/format;
 *  - `Server-Timing: cld-<cdn>;dur=…;desc=hit|miss` the CDN edge's own time and
 *    cache status (`cld-akam` on Akamai, `cld-cloudflare` on Cloudflare), and
 *    `rtt;dur=…` the round trip the edge measured to this client;
 *  - `Server-Timing: cloudinary;dur=…, transformation;dur=…` the origin's
 *    processing time — only present when the edge missed its cache;
 *  - `X-Cld-Error` explains failures, and HTTP 423 marks AI transformations
 *    Cloudinary is still rendering asynchronously.
 *
 * All of these headers are exposed to browsers via CORS by Cloudinary.
 */

export const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';

/**
 * The message a 423 result carries when Cloudinary sent no `X-Cld-Error`
 * header. It is VisualOps' wording, not Cloudinary's: compare against it (or
 * check `source`) before quoting a message as Cloudinary's.
 */
export const PROCESSING_MESSAGE = 'Cloudinary is processing this transformation';

export interface DeliveryMetrics {
  status: number;
  contentType?: string;
  bytes?: number;
  format?: string;
  width?: number;
  height?: number;
  originalBytes?: number;
  originalFormat?: string;
  originalWidth?: number;
  originalHeight?: number;
  cache?: 'hit' | 'miss';
  /** Time the CDN edge spent on the request, ms (`cld-akam;dur` / `cld-cloudflare;dur`). Present on hits and misses. */
  edgeMs?: number;
  /** Network round trip the CDN edge measured to this client, ms (`rtt;dur`). */
  rttMs?: number;
  /** Time Cloudinary's origin spent, ms (`cloudinary;dur`). Only present on CDN cache misses. */
  cloudinaryMs?: number;
  /** Time spent rendering the transformation, ms (`transformation;dur`). Only present when Cloudinary rendered it now. */
  transformMs?: number;
  /** Delivered video duration in seconds (`du`), when Cloudinary reports it. */
  duration?: number;
  /** Original (stored) video duration in seconds (`odu`), when Cloudinary reports it. */
  originalDuration?: number;
  /**
   * Round trip browser → Cloudinary → browser, ms. Read from Resource Timing
   * (request start → response end) when the browser reports it, so time the
   * response spent waiting for a busy main thread is not counted; otherwise
   * the wall-clock time around the request.
   */
  elapsedMs: number;
}

/**
 * Where a failure message came from:
 * - `x-cld-error`: Cloudinary's own `X-Cld-Error` header — safe to quote as Cloudinary's words;
 * - `status`: no header was sent; the message is VisualOps' fallback built from the HTTP status.
 * Absent on results built outside `probeUrl` (e.g. a browser decode failure) — never attribute those to Cloudinary.
 */
export type ProbeMessageSource = 'x-cld-error' | 'status';

export type ProbeResult =
  | { kind: 'ready'; metrics: DeliveryMetrics }
  | { kind: 'processing'; status: number; message: string; source?: ProbeMessageSource }
  | { kind: 'error'; status: number; message: string; source?: ProbeMessageSource }
  | { kind: 'network'; message: string };

const numMatch = (source: string, re: RegExp): number | undefined => {
  const m = source.match(re);
  return m ? Number(m[1]) : undefined;
};

const strMatch = (source: string, re: RegExp): string | undefined => {
  const m = source.match(re);
  return m ? m[1].toLowerCase() : undefined;
};

/**
 * Parses Cloudinary's Server-Timing header. Tolerant of both CDNs' layouts:
 *
 * - Akamai escapes the nested quotes (`format=\"avif\"`) and closes content-info
 *   with `",cloudinary;dur=…`;
 * - Cloudflare leaves them bare (`format="avif"`) and closes it with
 *   `";cloudinary;dur=…`, so the origin entry is not always comma-separated.
 */
export function parseServerTiming(header: string | null): Partial<DeliveryMetrics> {
  if (!header) return {};
  // Only the content-info entry carries these keys; `\b` keeps `bytes` from matching `obytes`.
  const cacheMatch = header.match(/\bcld-[a-z]+;[^,]*?desc=(hit|miss)/i);
  return {
    bytes: numMatch(header, /\bbytes=(\d+)/),
    format: strMatch(header, /\bformat=\\?"?([a-z0-9]+)/i),
    width: numMatch(header, /\bwidth=(\d+)/),
    height: numMatch(header, /\bheight=(\d+)/),
    originalBytes: numMatch(header, /\bobytes=(\d+)/),
    originalFormat: strMatch(header, /\boformat=\\?"?([a-z0-9]+)/i),
    originalWidth: numMatch(header, /\bowidth=(\d+)/),
    originalHeight: numMatch(header, /\boheight=(\d+)/),
    cache: cacheMatch ? (cacheMatch[1].toLowerCase() as 'hit' | 'miss') : undefined,
    edgeMs: numMatch(header, /\bcld-[a-z]+;dur=(\d+)/i),
    rttMs: numMatch(header, /(?:^|,)\s*rtt;dur=(\d+)/i),
    cloudinaryMs: numMatch(header, /(?:^|[,;"])\s*cloudinary;dur=(\d+)/i),
    transformMs: numMatch(header, /(?:^|[,;"])\s*transformation;dur=(\d+)/i),
    duration: numMatch(header, /\bdu=(\d+(?:\.\d+)?)/),
    originalDuration: numMatch(header, /\bodu=(\d+(?:\.\d+)?)/),
  };
}

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Yields one task. A message port is used because hidden tabs clamp timers to ≥ 1 s. */
function nextTask(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * Request start → response end of this probe's Resource Timing entry: the
 * first `fetch` entry for `url` that began at or after `since`. Entries from
 * `<img>`/`<video>` loads of the same URL (often served from memory cache) are
 * ignored.
 */
function resourceDuration(url: string, since: number): number | undefined {
  if (typeof performance === 'undefined' || typeof performance.getEntriesByName !== 'function') return undefined;
  const entries = performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[];
  let match: PerformanceResourceTiming | undefined;
  for (const entry of entries) {
    if (entry.initiatorType !== 'fetch' || entry.startTime < since - 1 || !(entry.responseEnd > entry.startTime)) continue;
    if (!match || entry.startTime < match.startTime) match = entry;
  }
  return match ? match.responseEnd - match.startTime : undefined;
}

/**
 * The request's network time. A wall-clock measurement around `await fetch()`
 * also counts every millisecond the response waited for a busy main thread
 * (a view mounting, a dev-mode compile), so Resource Timing is preferred. The
 * browser queues the entry a task or so after the response resolves; if it
 * never shows (e.g. a full timing buffer), the wall-clock time stands.
 */
async function networkTime(url: string, started: number, wallMs: number): Promise<number> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const duration = resourceDuration(url, started);
    if (duration !== undefined) return Math.min(duration, wallMs);
    await nextTask();
  }
  return wallMs;
}

export async function probeUrl(
  url: string,
  options: { accept?: string; signal?: AbortSignal } = {},
): Promise<ProbeResult> {
  const started = clock();
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: options.accept ? { Accept: options.accept } : undefined,
      cache: 'no-store',
      signal: options.signal,
    });
    const wallMs = clock() - started;
    const cldError = res.headers.get('x-cld-error')?.trim() || undefined;
    const source: ProbeMessageSource = cldError ? 'x-cld-error' : 'status';
    if (res.status === 423) {
      return { kind: 'processing', status: 423, message: cldError ?? PROCESSING_MESSAGE, source };
    }
    if (!res.ok) {
      return { kind: 'error', status: res.status, message: cldError ?? `HTTP ${res.status}`, source };
    }
    const timing = parseServerTiming(res.headers.get('server-timing'));
    const length = res.headers.get('content-length');
    const contentType = res.headers.get('content-type') ?? undefined;
    const elapsedMs = await networkTime(url, started, wallMs);
    return {
      kind: 'ready',
      metrics: {
        status: res.status,
        contentType,
        ...timing,
        bytes: timing.bytes ?? (length ? Number(length) : undefined),
        format: timing.format ?? contentType?.split(';')[0].split('/')[1],
        elapsedMs,
      },
    };
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw error;
    return { kind: 'network', message: (error as Error)?.message || 'Network error' };
  }
}

/* ------------------------------------------------------------------------ */
/* Per-frame notification scheduler                                          */
/* ------------------------------------------------------------------------ */

/*
 * A dataset view can fire dozens of HEAD and fl_getinfo responses within a few
 * hundred milliseconds. Notifying subscribers once per response re-rendered
 * every subscribed component once per response, so notifications are coalesced:
 * the stores below (results, `version`, the activity snapshot) are updated
 * synchronously — `useSyncExternalStore` snapshots are always current — while
 * listeners are told at most once per animation frame. Hidden tabs never run
 * animation frames, so they (and non-browser runtimes) fall back to a short
 * timer; a frame requested just before the tab is hidden is covered by the same
 * fallback.
 */

type Listener = () => void;

interface Channel {
  listeners: Set<Listener>;
  dirty: boolean;
}

const measurementChannel: Channel = { listeners: new Set(), dirty: false };
const activityChannel: Channel = { listeners: new Set(), dirty: false };
const CHANNELS = [measurementChannel, activityChannel];
const frameTasks = new Set<() => void>();

const HIDDEN_DELAY_MS = 16;
const FRAME_FALLBACK_MS = 250;

let frameHandle: number | null = null;
let timerHandle: ReturnType<typeof setTimeout> | null = null;

/** Calls `fn`; an exception is rethrown asynchronously so one failing listener never starves the rest. */
function safely(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    setTimeout(() => {
      throw error;
    }, 0);
  }
}

function flush(): void {
  if (frameHandle !== null) {
    cancelAnimationFrame(frameHandle);
    frameHandle = null;
  }
  if (timerHandle !== null) {
    clearTimeout(timerHandle);
    timerHandle = null;
  }
  // Tasks first: they may push activity, which is then delivered in this same pass.
  const tasks = Array.from(frameTasks);
  frameTasks.clear();
  tasks.forEach(safely);
  for (const channel of CHANNELS) {
    if (!channel.dirty) continue;
    channel.dirty = false;
    Array.from(channel.listeners).forEach(safely);
  }
}

function scheduleFlush(): void {
  if (frameHandle !== null || timerHandle !== null) return;
  const visible = typeof document !== 'undefined' && document.visibilityState !== 'hidden';
  if (visible && typeof requestAnimationFrame === 'function') {
    frameHandle = requestAnimationFrame(flush);
    timerHandle = setTimeout(flush, FRAME_FALLBACK_MS);
  } else {
    timerHandle = setTimeout(flush, HIDDEN_DELAY_MS);
  }
}

function markDirty(channel: Channel): void {
  channel.dirty = true;
  scheduleFlush();
}

function subscribeTo(channel: Channel, listener: Listener): () => void {
  channel.listeners.add(listener);
  return () => {
    if (!channel.listeners.delete(listener)) return;
    // A change made while this listener was subscribed is never dropped: an
    // imperative subscriber that unsubscribes right after awaiting a probe
    // still hears about that probe's final result.
    if (channel.dirty) safely(listener);
  };
}

/**
 * Runs `task` once in the next shared notification frame, together with the
 * measurement and activity listeners. Scheduling the same function again before
 * the frame runs it only once. Returns a function that cancels the task.
 *
 * Use it to coalesce per-response React state updates (e.g. a hook that fans
 * out many `fetchInsight` calls): gather results in a ref, then schedule one
 * stable flush function.
 */
export function schedulePerFrame(task: () => void): () => void {
  frameTasks.add(task);
  scheduleFlush();
  return () => {
    frameTasks.delete(task);
  };
}

/* ------------------------------------------------------------------------ */
/* Shared measurement registry                                              */
/* ------------------------------------------------------------------------ */

const results = new Map<string, ProbeResult>();
const inflight = new Map<string, Promise<ProbeResult>>();
let version = 0;

function emit() {
  version += 1;
  markDirty(measurementChannel);
}

/**
 * Subscribes to measurement changes. Listeners are called at most once per
 * animation frame (see the scheduler above); read `getMeasurement` /
 * `measurementsVersion` for the current state, which is always up to date.
 */
export function subscribeMeasurements(listener: Listener): () => void {
  return subscribeTo(measurementChannel, listener);
}

export function measurementsVersion(): number {
  return version;
}

export function getMeasurement(url: string): ProbeResult | undefined {
  return results.get(url);
}

/** True while a probe for `url` is in flight: `measure(url)` would join it instead of sending a request. */
export function isMeasuring(url: string): boolean {
  return inflight.has(url);
}

export function allMeasurements(): Array<[string, ProbeResult]> {
  return Array.from(results.entries());
}

/* ------------------------------------------------------------------------ */
/* Session activity log — real Cloudinary events only                        */
/* ------------------------------------------------------------------------ */

export type ActivityKind = 'delivered' | 'processing' | 'error' | 'insight';

export interface ActivityEvent {
  id: number;
  at: number;
  kind: ActivityKind;
  url: string;
  /** Public ID (last path segment) the event concerns. */
  subject: string;
  /** Transformation components, e.g. "c_limit,w_1600 / q_auto / f_auto". */
  transformation: string;
  detail: string;
  metrics?: DeliveryMetrics;
}

const ACTIVITY_LIMIT = 80;
let activitySnapshot: ActivityEvent[] = [];
let activityId = 0;

function describeUrl(url: string): { subject: string; transformation: string } {
  const m = url.match(/\/(?:image|video)\/upload\/(.*)$/);
  if (!m) return { subject: url, transformation: '' };
  const parts = m[1].split('/');
  const components = parts.filter((p) => /^[a-z]{1,3}_[^/]*$/.test(p) && !p.includes('.'));
  const subject = parts.slice(components.length).join('/') || parts[parts.length - 1];
  return { subject, transformation: components.join(' / ') };
}

export function pushActivity(kind: ActivityKind, url: string, detail: string, metrics?: DeliveryMetrics): void {
  activityId += 1;
  const event: ActivityEvent = { id: activityId, at: Date.now(), kind, url, detail, metrics, ...describeUrl(url) };
  activitySnapshot = [event, ...activitySnapshot].slice(0, ACTIVITY_LIMIT);
  markDirty(activityChannel);
}

/** Subscribes to the activity log. Like measurements, listeners are called at most once per frame. */
export function subscribeActivity(listener: Listener): () => void {
  return subscribeTo(activityChannel, listener);
}

export function getActivity(): ActivityEvent[] {
  return activitySnapshot;
}

const EMPTY_ACTIVITY: ActivityEvent[] = [];
export function getServerActivity(): ActivityEvent[] {
  return EMPTY_ACTIVITY;
}

/** "HTTP 404 · <X-Cld-Error>" when Cloudinary explained the failure, plain "HTTP 404" otherwise. */
function failureDetail(result: Extract<ProbeResult, { kind: 'error' }>): string {
  return result.source === 'x-cld-error' ? `HTTP ${result.status} · ${result.message}` : `HTTP ${result.status}`;
}

function logProbe(url: string, result: ProbeResult, previous: ProbeResult | undefined): void {
  if (result.kind === 'ready') {
    const m = result.metrics;
    const size = m.bytes !== undefined ? `${Math.round(m.bytes / 1024)} KB` : 'size n/a';
    pushActivity('delivered', url, `${(m.format ?? '').toUpperCase()} ${size} · CDN ${m.cache ?? 'n/a'} · ${Math.round(m.elapsedMs)} ms`, m);
  } else if (result.kind === 'processing') {
    if (previous?.kind !== 'processing') pushActivity('processing', url, 'HTTP 423 · Cloudinary rendering asynchronously');
  } else {
    pushActivity('error', url, result.kind === 'network' ? result.message : failureDetail(result));
  }
}

/** Probes once per URL (deduplicated), polling while Cloudinary answers 423. */
export function measure(
  url: string,
  options: { accept?: string; pollMs?: number; timeoutMs?: number; force?: boolean } = {},
): Promise<ProbeResult> {
  const cached = results.get(url);
  if (!options.force && cached && cached.kind !== 'processing' && cached.kind !== 'network') {
    return Promise.resolve(cached);
  }
  const existing = inflight.get(url);
  if (existing) return existing;

  const pollMs = options.pollMs ?? 2500;
  const deadline = Date.now() + (options.timeoutMs ?? 120_000);

  const run = async (): Promise<ProbeResult> => {
    for (;;) {
      const result = await probeUrl(url, { accept: options.accept });
      const previous = results.get(url);
      results.set(url, result);
      logProbe(url, result, previous);
      emit();
      if (result.kind !== 'processing' || Date.now() > deadline) return result;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  };

  const promise = run().finally(() => inflight.delete(url));
  inflight.set(url, promise);
  return promise;
}
