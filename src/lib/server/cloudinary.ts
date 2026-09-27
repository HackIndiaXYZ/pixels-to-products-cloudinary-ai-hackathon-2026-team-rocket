import 'server-only';
import { v2 as cloudinary } from 'cloudinary';

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
