import type { Category, MediaAsset, ResourceType, Severity } from '@/lib/types';
import type { CloudResource, UploadSignature } from './backend';
import { derivedFindingId, encodeContext } from './ingest-fields';

export { encodeContext } from './ingest-fields';

/**
 * Ingestion into the team's own Cloudinary cloud:
 *
 *  - Signed upload (with the VisualOps server): the browser asks POST /api/cloudinary/sign for a
 *    signature over the record fields, then uploads the file straight to the Upload API
 *    (POST https://api.cloudinary.com/v1_1/<cloud>/auto/upload) with the signed parameters and the
 *    team's signed upload preset. The API secret stays on the server.
 *  - Unsigned upload (no server, e.g. a static deployment): an unsigned upload preset.
 *  Either way the structured fields travel as Cloudinary `tags` and contextual metadata
 *  (`context`), so Cloudinary is the system of record.
 *  - Read back: GET /api/assets (Cloudinary Search API, server-side) or, without a server, the
 *    client-side resource list (GET res.cloudinary.com/<cloud>/<type>/list/<tag>.json).
 */

export interface IngestMetadata {
  title: string;
  site: string;
  category: Category;
  severity?: Severity;
  note?: string;
}

export interface UploadResponse {
  asset_id?: string;
  public_id: string;
  version?: number;
  format: string;
  resource_type: ResourceType | 'raw';
  width?: number;
  height?: number;
  bytes?: number;
  duration?: number;
  created_at?: string;
  tags?: string[];
  context?: { custom?: Record<string, string> };
  original_filename?: string;
  secure_url?: string;
}

export class CloudinaryRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'CloudinaryRequestError';
    this.status = status;
  }
}

export type UploadOptions =
  | {
      /** Unsigned upload through a public upload preset (no server). */
      cloudName: string;
      uploadPreset: string;
      tags: string[];
      metadata: IngestMetadata & { findingId?: string };
      onProgress?: (fraction: number) => void;
    }
  | {
      /** Signed upload: parameters and signature issued by POST /api/cloudinary/sign. */
      signed: UploadSignature;
      onProgress?: (fraction: number) => void;
    };

export function uploadFile(file: File, options: UploadOptions): Promise<UploadResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append('file', file);
    let cloudName: string;
    if ('signed' in options) {
      // Exactly the signed parameters, unchanged, plus the public API key and the signature.
      cloudName = options.signed.cloudName;
      for (const [key, value] of Object.entries(options.signed.params)) form.append(key, value);
      form.append('api_key', options.signed.apiKey);
      form.append('signature', options.signed.signature);
    } else {
      cloudName = options.cloudName;
      form.append('upload_preset', options.uploadPreset);
      form.append('tags', options.tags.join(','));
      form.append(
        'context',
        encodeContext({
          title: options.metadata.title,
          site: options.metadata.site,
          category: options.metadata.category,
          severity: options.metadata.severity,
          note: options.metadata.note,
          finding_id: options.metadata.findingId,
          source: 'visualops',
        }),
      );
    }

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/auto/upload`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };
    xhr.onerror = () => reject(new CloudinaryRequestError('Network error while uploading to Cloudinary', 0));
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error body */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) {
        resolve(body as UploadResponse);
        return;
      }
      const message =
        (body as { error?: { message?: string } } | null)?.error?.message ?? `Upload failed with HTTP ${xhr.status}`;
      reject(new CloudinaryRequestError(message, xhr.status));
    };
    xhr.send(form);
  });
}

export interface ListedResource {
  public_id: string;
  version?: number;
  format: string;
  width?: number;
  height?: number;
  type?: string;
  created_at?: string;
  context?: { custom?: Record<string, string> };
}

export async function listByTag(cloudName: string, tag: string, resourceType: ResourceType): Promise<ListedResource[]> {
  const url = `https://res.cloudinary.com/${encodeURIComponent(cloudName)}/${resourceType}/list/${encodeURIComponent(tag)}.json`;
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) return []; // Cloudinary answers 404 when nothing carries the tag.
  if (!res.ok) {
    const reason = res.headers.get('x-cld-error');
    const hint =
      res.status === 401
        ? 'Resource lists are restricted on this cloud. Enable “Resource list” under Settings → Security in the Cloudinary console.'
        : '';
    throw new CloudinaryRequestError([reason ?? `HTTP ${res.status}`, hint].filter(Boolean).join(' — '), res.status);
  }
  const data = (await res.json()) as { resources?: ListedResource[] };
  return data.resources ?? [];
}

const CATEGORIES: Category[] = ['structural', 'safety', 'equipment', 'electrical', 'facilities', 'inventory'];
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

function toCategory(value: string | undefined): Category {
  return CATEGORIES.includes(value as Category) ? (value as Category) : 'facilities';
}

function toSeverity(value: string | undefined): Severity | undefined {
  return SEVERITIES.includes(value as Severity) ? (value as Severity) : undefined;
}


interface AssetInput {
  cloudName: string;
  publicId: string;
  resourceType: ResourceType;
  format: string;
  width?: number;
  height?: number;
  bytes?: number;
  duration?: number;
  createdAt?: string;
  fileName?: string;
  tags?: string[];
  context?: Record<string, string>;
  source: 'upload' | 'sync';
}

/** Maps an upload or list response (plus its Cloudinary context) onto a VisualOps record. */
export function toMediaAsset(input: AssetInput): MediaAsset {
  const ctx = input.context ?? {};
  const severity = toSeverity(ctx.severity);
  const category = toCategory(ctx.category);
  const title = ctx.title || input.fileName || input.publicId.split('/').pop() || 'Untitled capture';
  return {
    id: `${input.source}-${input.cloudName}-${input.publicId}`,
    cloudName: input.cloudName,
    publicId: input.publicId,
    resourceType: input.resourceType,
    format: input.format,
    width: input.width ?? 1600,
    height: input.height ?? 900,
    bytes: input.bytes,
    duration: input.duration,
    posterOffset: input.resourceType === 'video' ? 1 : undefined,
    fileName: input.fileName ? `${input.fileName}.${input.format}` : `${input.publicId.split('/').pop()}.${input.format}`,
    title,
    site: ctx.site || 'Unassigned',
    capturedAt: input.createdAt ?? new Date().toISOString(),
    capturedBy: input.source === 'upload' ? 'Uploaded in VisualOps' : 'Synced from Cloudinary',
    tags: Array.from(new Set([...(input.tags ?? []), ...(ctx.category ? [category] : [])])).filter((t) => t !== 'visualops'),
    source: input.source,
    finding: severity
      ? {
          // Stable across reloads and devices: written at ingest, otherwise derived from the asset.
          id: ctx.finding_id || derivedFindingId(input.cloudName, input.publicId),
          title,
          category,
          severity,
          status: 'open',
          summary: ctx.note || 'Reported at ingest. Review the media and refine the record.',
          action: 'Assign an owner and schedule a follow-up inspection.',
        }
      : undefined,
  };
}

/** Maps a record read back from the team's cloud (GET /api/assets) onto a VisualOps record. */
export function cloudResourceToAsset(cloudName: string, r: CloudResource): MediaAsset {
  return toMediaAsset({
    cloudName,
    publicId: r.public_id,
    resourceType: r.resource_type,
    format: r.format,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    duration: r.duration,
    createdAt: r.created_at,
    fileName: r.display_name,
    tags: r.tags,
    context: r.context,
    // Records created by VisualOps' own ingest carry context source=visualops; anything else was tagged elsewhere.
    source: r.context.source === 'visualops' ? 'upload' : 'sync',
  });
}
