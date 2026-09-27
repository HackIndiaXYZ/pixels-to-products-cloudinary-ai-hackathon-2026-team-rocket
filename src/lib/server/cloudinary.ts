import 'server-only';
import { v2 as cloudinary } from 'cloudinary';
import { CONTEXT_CATEGORIES, CONTEXT_SEVERITIES, encodeContext } from '@/lib/cloudinary/ingest-fields';

/**
 * Server-side Cloudinary configuration. The API secret is read from the server
 * environment only (never a NEXT_PUBLIC_ variable), is used to sign requests and
 * to call the Search API, and is never returned to the browser or logged.
 */

export interface ServerCloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  /** Optional signed upload preset (e.g. `visualops_uploads`); signed together with the other params. */
  uploadPreset?: string;
  /** Tag that marks VisualOps records in the cloud. */
  tag: string;
}

const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/i;
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

/** Returns the server configuration, or null when the Cloudinary credentials are not set. */
export function serverConfig(): ServerCloudinaryConfig | null {
  const cloudName = env('CLOUDINARY_CLOUD_NAME') ?? env('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME');
  const apiKey = env('CLOUDINARY_API_KEY');
  const apiSecret = env('CLOUDINARY_API_SECRET');
  if (!cloudName || !apiKey || !apiSecret || !NAME_PATTERN.test(cloudName)) return null;
  const preset = env('CLOUDINARY_UPLOAD_PRESET');
  const tag = env('VISUALOPS_TAG') ?? env('NEXT_PUBLIC_VISUALOPS_TAG') ?? 'visualops';
  return {
    cloudName,
    apiKey,
    apiSecret,
    uploadPreset: preset && /^[\w-]{1,80}$/.test(preset) ? preset : undefined,
    tag: TAG_PATTERN.test(tag) ? tag : 'visualops',
  };
}

/** The Cloudinary Node SDK configured for this request. */
export function cloudinaryFor(config: ServerCloudinaryConfig) {
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true,
  });
  return cloudinary;
}

/** JSON error response. Messages are safe to show to the user and never include credentials. */
export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return Response.json({ error, ...extra }, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const NOT_CONFIGURED =
  'Cloudinary is not configured on the server. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET (see .env.example).';

/**
 * Browser requests to the signing endpoint must come from this site. Blocks other websites from
 * using a visitor's browser to obtain signatures. (Non-browser clients are limited by the rate limiter.)
 */
export function isSameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).host === new URL(request.url).host;
  } catch {
    return false;
  }
}

/** Best-effort, per-instance fixed-window rate limiter keyed by client address. */
const windows = new Map<string, { start: number; count: number }>();
export function rateLimited(request: Request, key: string, limit: number, windowMs: number): boolean {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local';
  const id = `${key}:${ip}`;
  const now = Date.now();
  const entry = windows.get(id);
  if (!entry || now - entry.start > windowMs) {
    windows.set(id, { start: now, count: 1 });
    if (windows.size > 5000) windows.clear();
    return false;
  }
  entry.count += 1;
  return entry.count > limit;
}

/** Cloudinary SDK errors carry `error.message` / `http_code`; keep only what is safe to surface. */
export function cloudinaryErrorMessage(error: unknown): { message: string; status: number } {
  const e = error as { error?: { message?: string; http_code?: number }; message?: string; http_code?: number };
  const message = e?.error?.message ?? e?.message ?? 'Cloudinary request failed';
  const status = e?.error?.http_code ?? e?.http_code ?? 502;
  return { message: message.replace(/api_secret[^,;\s]*/gi, '[redacted]'), status: status >= 400 && status < 600 ? status : 502 };
}

/* -------------------------------------------------------------------------- */
/* Structured metadata                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The structured metadata fields VisualOps writes when they exist on the cloud. They are created by
 * `npm run setup:cloudinary` (scripts/lib/cloudinary-admin.mjs holds the same definitions — keep the two
 * in sync). Enum values are datasource entries whose external_id is the value itself.
 */
export const STRUCTURED_METADATA_FIELDS = [
  { externalId: 'vo_category', type: 'enum', values: CONTEXT_CATEGORIES as readonly string[] },
  { externalId: 'vo_severity', type: 'enum', values: CONTEXT_SEVERITIES as readonly string[] },
  { externalId: 'vo_status', type: 'enum', values: ['open', 'monitoring', 'resolved'] as readonly string[] },
  { externalId: 'vo_site', type: 'string', values: [] as readonly string[] },
] as const;

/** Longest site the vo_site field accepts (matches the ingest `site` limit and the field's strlen validation). */
export const STRUCTURED_SITE_MAX = 60;

interface ListedMetadataField {
  external_id?: string;
  type?: string;
  datasource?: { values?: { external_id?: string; state?: string }[] };
}

/** True when every VisualOps field exists with the expected type and, for enums, every value is an active entry. */
export function structuredMetadataComplete(fields: readonly ListedMetadataField[] | undefined): boolean {
  if (!Array.isArray(fields)) return false;
  return STRUCTURED_METADATA_FIELDS.every((expected) => {
    const field = fields.find((f) => f?.external_id === expected.externalId);
    if (!field || field.type !== expected.type) return false;
    if (expected.type !== 'enum') return true;
    const entries: { external_id?: string; state?: string }[] = Array.isArray(field.datasource?.values) ? field.datasource.values : [];
    const active = new Set(entries.filter((v) => v?.state !== 'inactive').map((v) => v?.external_id));
    return expected.values.every((value) => active.has(value));
  });
}

const READY_TTL_MS = 5 * 60 * 1000;
/** A missing field or a failed lookup is re-checked sooner, so running the setup script is picked up quickly. */
const NOT_READY_TTL_MS = 60 * 1000;
const LOOKUP_TIMEOUT_MS = 4000;

let readyCache: { key: string; ready: boolean; expires: number } | null = null;
let readyLookup: { key: string; promise: Promise<boolean> } | null = null;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Whether the cloud has the VisualOps structured metadata fields (vo_category, vo_severity, vo_status,
 * vo_site). Lists the fields with the Admin API and caches the answer per server instance (5 minutes when
 * ready, 1 minute otherwise). Never throws: any failure (network, permissions, timeout) answers false, so
 * uploads simply go without structured metadata.
 */
export function metadataFieldsReady(config: ServerCloudinaryConfig): Promise<boolean> {
  const key = `${config.cloudName}:${config.apiKey}`;
  if (readyCache && readyCache.key === key && readyCache.expires > Date.now()) return Promise.resolve(readyCache.ready);
  if (readyLookup && readyLookup.key === key) return readyLookup.promise;

  const promise = (async () => {
    let ready = false;
    try {
      const result = (await withTimeout(cloudinaryFor(config).api.list_metadata_fields(), LOOKUP_TIMEOUT_MS)) as {
        metadata_fields?: ListedMetadataField[];
      };
      ready = structuredMetadataComplete(result?.metadata_fields);
    } catch {
      ready = false;
    }
    readyCache = { key, ready, expires: Date.now() + (ready ? READY_TTL_MS : NOT_READY_TTL_MS) };
    if (readyLookup?.key === key) readyLookup = null;
    return ready;
  })();
  readyLookup = { key, promise };
  return promise;
}

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;

/**
 * The signed `metadata` upload parameter ("vo_category=…|vo_severity=…|vo_status=…|vo_site=…"), built only
 * from validated values: enums must be known values, the site is stripped of control characters, trimmed
 * and length-limited, and `=` / `|` are escaped as Cloudinary documents. Missing or invalid values are
 * omitted; returns undefined when nothing is left.
 */
export function structuredMetadataParam(fields: {
  category?: string;
  severity?: string;
  status?: string;
  site?: string;
}): string | undefined {
  const [category, severity, status] = STRUCTURED_METADATA_FIELDS;
  const pick = (value: string | undefined, allowed: readonly string[]) =>
    value && allowed.includes(value) ? value : undefined;
  const site = fields.site?.replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim().slice(0, STRUCTURED_SITE_MAX).trim();
  const encoded = encodeContext({
    vo_category: pick(fields.category, category.values),
    vo_severity: pick(fields.severity, severity.values),
    vo_status: pick(fields.status, status.values),
    vo_site: site || undefined,
  });
  return encoded || undefined;
}
