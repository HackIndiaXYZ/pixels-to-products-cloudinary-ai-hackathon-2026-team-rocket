/**
 * Live delivery probes.
 *
 * VisualOps never invents delivery numbers. Every size, format, cache status
 * and processing time shown in the UI is read from Cloudinary's own response
 * headers:
 *
 *  - `Server-Timing: content-info;desc="width=…,bytes=…,format=…,obytes=…,oformat=…"`
 *    exposes the delivered and the original byte size/format;
 *  - `Server-Timing: cloudinary;dur=…, transformation;dur=…` the processing time;
 *  - `X-Cld-Error` explains failures, and HTTP 423 marks AI transformations
 *    Cloudinary is still rendering asynchronously.
 *
 * All of these headers are exposed to browsers via CORS by Cloudinary.
 */

export const IMAGE_ACCEPT = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8';

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
  cloudinaryMs?: number;
  transformMs?: number;
  /** Video duration in seconds, when Cloudinary reports it. */
  duration?: number;
  elapsedMs: number;
}

export type ProbeResult =
  | { kind: 'ready'; metrics: DeliveryMetrics }
  | { kind: 'processing'; status: number; message: string }
  | { kind: 'error'; status: number; message: string }
  | { kind: 'network'; message: string };

const intMatch = (source: string, re: RegExp): number | undefined => {
  const m = source.match(re);
  return m ? Number(m[1]) : undefined;
};

const strMatch = (source: string, re: RegExp): string | undefined => {
  const m = source.match(re);
  return m ? m[1].toLowerCase() : undefined;
};

/** Parses Cloudinary's Server-Timing header. Tolerant of its nested quoting. */
export function parseServerTiming(header: string | null): Partial<DeliveryMetrics> {
  if (!header) return {};
  // Only the content-info entry carries these keys; `\b` keeps `bytes` from matching `obytes`.
  const cacheMatch = header.match(/cld-[a-z]+;[^,]*?desc=(hit|miss)/i);
  return {
    bytes: intMatch(header, /\bbytes=(\d+)/),
    format: strMatch(header, /\bformat="?([a-z0-9]+)/i),
    width: intMatch(header, /\bwidth=(\d+)/),
    height: intMatch(header, /\bheight=(\d+)/),
    originalBytes: intMatch(header, /\bobytes=(\d+)/),
    originalFormat: strMatch(header, /\boformat="?([a-z0-9]+)/i),
    originalWidth: intMatch(header, /\bowidth=(\d+)/),
    originalHeight: intMatch(header, /\boheight=(\d+)/),
    cache: cacheMatch ? (cacheMatch[1].toLowerCase() as 'hit' | 'miss') : undefined,
    cloudinaryMs: intMatch(header, /(?:^|,)\s*cloudinary;dur=(\d+)/i),
    transformMs: intMatch(header, /transformation;dur=(\d+)/i),
    duration: intMatch(header, /\bdu=(\d+(?:\.\d+)?)/),
  };
}

export async function probeUrl(
  url: string,
  options: { accept?: string; signal?: AbortSignal } = {},
): Promise<ProbeResult> {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: options.accept ? { Accept: options.accept } : undefined,
      cache: 'no-store',
      signal: options.signal,
    });
    const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started;
    const cldError = res.headers.get('x-cld-error') ?? undefined;
    if (res.status === 423) {
      return { kind: 'processing', status: 423, message: cldError ?? 'Cloudinary is processing this transformation' };
    }
    if (!res.ok) {
      return { kind: 'error', status: res.status, message: cldError ?? `HTTP ${res.status}` };
    }
    const timing = parseServerTiming(res.headers.get('server-timing'));
    const length = res.headers.get('content-length');
    const contentType = res.headers.get('content-type') ?? undefined;
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
/* Shared measurement registry                                              */
/* ------------------------------------------------------------------------ */

type Listener = () => void;

const results = new Map<string, ProbeResult>();
const inflight = new Map<string, Promise<ProbeResult>>();
const listeners = new Set<Listener>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

export function subscribeMeasurements(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function measurementsVersion(): number {
  return version;
}

export function getMeasurement(url: string): ProbeResult | undefined {
  return results.get(url);
}

export function allMeasurements(): Array<[string, ProbeResult]> {
  return Array.from(results.entries());
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
      results.set(url, result);
      emit();
      if (result.kind !== 'processing' || Date.now() > deadline) return result;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  };

  const promise = run().finally(() => inflight.delete(url));
  inflight.set(url, promise);
  return promise;
}
