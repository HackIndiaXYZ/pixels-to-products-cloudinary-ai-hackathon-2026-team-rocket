import type { IngestContext } from './ingest-fields';

/**
 * Browser client for the VisualOps server routes (src/app/api/*). The server holds the
 * Cloudinary API secret; the browser only ever receives public values and signatures.
 */

export interface BackendConfig {
  configured: boolean;
  cloudName?: string;
  uploadPreset?: string | null;
  tag?: string;
  signedUploads?: boolean;
}

/** A Cloudinary resource as returned by GET /api/assets (context flattened). */
export interface CloudResource {
  public_id: string;
  asset_id?: string;
  resource_type: 'image' | 'video';
  format: string;
  width?: number;
  height?: number;
  bytes?: number;
  duration?: number;
  created_at?: string;
  display_name?: string;
  tags: string[];
  context: Record<string, string>;
}

export interface CloudAssetsPage {
  cloudName: string;
  tag: string;
  resources: CloudResource[];
  nextCursor: string | null;
  total: number;
}

export interface UploadSignature {
  cloudName: string;
  apiKey: string;
  signature: string;
  /** Exactly the parameters that were signed; send them unchanged. */
  params: Record<string, string>;
}

export class BackendError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'BackendError';
    this.status = status;
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok || !body) throw new BackendError(body?.error ?? `Server answered HTTP ${res.status}`, res.status);
  return body;
}

/** Whether the server is connected to a Cloudinary cloud (a static export has no server: treated as not configured). */
export async function fetchBackendConfig(signal?: AbortSignal): Promise<BackendConfig> {
  try {
    const res = await fetch('/api/cloudinary/config', { cache: 'no-store', signal });
    if (!res.ok) return { configured: false };
    return (await res.json()) as BackendConfig;
  } catch {
    return { configured: false };
  }
}

export async function requestUploadSignature(body: { tags: string[]; context: IngestContext }): Promise<UploadSignature> {
  const res = await fetch('/api/cloudinary/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  return readJson<UploadSignature>(res);
}

/** Every VisualOps record in the cloud (follows next_cursor up to `maxPages`). */
export async function fetchCloudAssets(signal?: AbortSignal, maxPages = 5): Promise<CloudAssetsPage> {
  let cursor: string | null = null;
  let page: CloudAssetsPage | null = null;
  const resources: CloudResource[] = [];
  for (let i = 0; i < maxPages; i += 1) {
    const url: string = cursor ? `/api/assets?cursor=${encodeURIComponent(cursor)}` : '/api/assets';
    const res: Response = await fetch(url, { cache: 'no-store', signal });
    page = await readJson<CloudAssetsPage>(res);
    resources.push(...page.resources);
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  if (!page) throw new BackendError('No response from /api/assets', 0);
  return { ...page, resources, nextCursor: cursor };
}
