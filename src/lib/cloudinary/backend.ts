import type { AiUnderstanding, ResourceType } from '@/lib/types';
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

/**
 * One VisualOps record read back from Cloudinary by its exact public_id (GET /api/assets?public_id=…,
 * Search API). Null when the cloud has no such record — or the Search index has not caught up yet.
 * The second argument is an AbortSignal, or `{ resourceType, signal }` — an image and a video may share
 * a public ID, and `resourceType` picks one.
 */
export async function findCloudAsset(
  publicId: string,
  options: AbortSignal | { resourceType?: ResourceType; signal?: AbortSignal } = {},
): Promise<CloudResource | null> {
  const { resourceType, signal } = options instanceof AbortSignal ? { resourceType: undefined, signal: options } : options;
  const res = await fetch(`/api/assets?public_id=${encodeURIComponent(publicId)}`, { cache: 'no-store', signal });
  const page = await readJson<CloudAssetsPage>(res);
  return page.resources.find((r) => r.public_id === publicId && (!resourceType || r.resource_type === resourceType)) ?? null;
}

/** What POST /api/assets/[id]/analyze returns. */
export interface AnalyzeResult {
  /** Cloudinary AI understanding (captioning + coco_v2 object detection). Machine-generated: label it "AI detected". */
  ai: AiUnderstanding;
  /** The asset's full tag list after auto-tagging (still includes the VisualOps tag). */
  tags: string[];
  /** True when the asset had been analysed before and the stored result was returned (no detections spent). */
  cached?: boolean;
  /** Set when one of the two detections failed and only the other one's result was saved. */
  warning?: string;
}

const assetPath = (publicId: string) => `/api/assets/${encodeURIComponent(publicId)}`;

/**
 * Asks the server to understand an image with Cloudinary AI (captioning, then object detection with
 * auto-tagging) and store the result in the asset's contextual metadata. Images only.
 * An image analysed before returns its stored result without spending detections.
 */
export async function analyzeAsset(
  publicId: string,
  resourceType: ResourceType,
  options: { signal?: AbortSignal } = {},
): Promise<AnalyzeResult> {
  if (resourceType !== 'image') {
    throw new BackendError('AI analysis runs on images. A video keeps its face and crop signals (fl_getinfo on the poster frame).', 400);
  }
  const res = await fetch(`${assetPath(publicId)}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceType }),
    cache: 'no-store',
    signal: options.signal,
  });
  return readJson<AnalyzeResult>(res);
}

/**
 * Takes a record out of the VisualOps workspace by removing the VisualOps tag from the asset
 * (DELETE /api/assets/[id]). Non-destructive: the media stays in Cloudinary.
 */
export async function untagAsset(publicId: string, resourceType: ResourceType): Promise<{ removed: boolean; publicId: string; tag: string }> {
  const res = await fetch(`${assetPath(publicId)}?resourceType=${resourceType}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resourceType }),
    cache: 'no-store',
  });
  return readJson<{ removed: boolean; publicId: string; tag: string }>(res);
}
