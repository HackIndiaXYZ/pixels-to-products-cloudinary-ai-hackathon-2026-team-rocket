import type { AiUnderstanding, AssetSource, Category, FindingStatus, MediaAsset, Region, ResourceType, Severity } from '@/lib/types';
import { decodeAiContext } from './ai';
import type { CloudResource, UploadSignature } from './backend';
import { derivedFindingId, encodeContext } from './ingest-fields';
import { CTX } from './record-context';

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


// ---- record mapping (the context contract in ./record-context) ----------------

const CATEGORIES: Category[] = ['structural', 'safety', 'equipment', 'electrical', 'facilities', 'inventory'];
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
const STATUSES: FindingStatus[] = ['open', 'monitoring', 'resolved'];
const HOUR = 3_600_000;
/** The collection tag when the caller does not name the server's. */
const DEFAULT_TAG = 'visualops';

function isCategory(value: string | undefined): value is Category {
  return CATEGORIES.includes(value as Category);
}

function toSeverity(value: string | undefined): Severity | undefined {
  return SEVERITIES.includes(value as Severity) ? (value as Severity) : undefined;
}

function toStatus(value: string | undefined): FindingStatus {
  return STATUSES.includes(value as FindingStatus) ? (value as FindingStatus) : 'open';
}

const clampPct = (n: number) => Math.max(0, Math.min(100, n));

/** `region` context value — "x,y,w,h" in percent of the frame, optionally ",LABEL" — as a Region. */
export function parseRegion(value: string | undefined): Region | undefined {
  if (!value) return undefined;
  const [xs, ys, ws, hs, ...rest] = value.split(',');
  const nums = [xs, ys, ws, hs].map((s) => (s === undefined || s.trim() === '' ? NaN : Number(s)));
  if (!nums.every((n) => Number.isFinite(n))) return undefined;
  const x = clampPct(nums[0]);
  const y = clampPct(nums[1]);
  const w = Math.min(clampPct(nums[2]), 100 - x);
  const h = Math.min(clampPct(nums[3]), 100 - y);
  if (w <= 0 || h <= 0) return undefined;
  const label = rest.join(',').trim();
  return label ? { x, y, w, h, label } : { x, y, w, h };
}

/** When the capture happened, and how that time is known (see CaptureBasis). */
function captureOf(
  ctx: Record<string, string>,
  createdAt: string | undefined,
  now: number,
): Pick<MediaAsset, 'capturedAt' | 'captureBasis' | 'cameraTime'> {
  const hoursAgo = ctx[CTX.sampleHoursAgo]?.trim() ? Number(ctx[CTX.sampleHoursAgo]) : NaN;
  if (Number.isFinite(hoursAgo) && hoursAgo >= 0) {
    // Sample workspace: an offset materialised against the viewer's clock, labelled as sample time.
    return { capturedAt: new Date(now - hoursAgo * HOUR).toISOString(), captureBasis: 'sample-relative' };
  }
  const fixed = ctx[CTX.capturedAt] ? Date.parse(ctx[CTX.capturedAt]) : NaN;
  if (Number.isFinite(fixed)) {
    const cameraTime = ctx[CTX.cameraTime]?.trim();
    return { capturedAt: new Date(fixed).toISOString(), captureBasis: 'fixed', ...(cameraTime ? { cameraTime } : {}) };
  }
  // Neither: the time Cloudinary recorded for the upload.
  return { capturedAt: createdAt ?? new Date(now).toISOString(), captureBasis: 'recorded' };
}

/** "Captured by" when the record does not say (captured_by): who brought the media in, never an invented person. */
const CAPTURED_BY: Record<AssetSource, string> = {
  sample: 'Not recorded · sample workspace',
  upload: 'Uploaded in VisualOps',
  sync: 'Synced from Cloudinary',
};

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
  /** Where the response came from. The record's `provenance` context key, when present, decides instead. */
  source: 'upload' | 'sync';
  /** The VisualOps collection tag, kept off the record's tags (default "visualops"). */
  tag?: string;
  /** The clock sample-relative capture times are materialised against (default: now). */
  now?: number;
}

/**
 * Maps an upload, Search or list response (plus its Cloudinary contextual metadata) onto a
 * VisualOps record, reading the full context contract (lib/cloudinary/record-context):
 *  - provenance "sample-annotation" → source `sample` (team-written sample workspace), "ingest" → `upload`
 *  - title, site, zone, category, severity, status, note, action, finding_id, region → the finding
 *  - captured_by, file_name, poster_offset → the record
 *  - sample_hours_ago | captured_at (+ camera_time) | Cloudinary's created_at → the capture time
 *  - ai_* → `ai` (Cloudinary AI understanding)
 * The record's tags are the asset's human tags: its Cloudinary tags minus the VisualOps tag and minus
 * the tags Cloudinary's auto-tagging added (those live in `ai.tags`, labelled AI detected).
 */
export function toMediaAsset(input: AssetInput): MediaAsset {
  const ctx = input.context ?? {};
  const provenance = ctx[CTX.provenance];
  const source: AssetSource = provenance === 'sample-annotation' ? 'sample' : provenance === 'ingest' ? 'upload' : input.source;
  const severity = toSeverity(ctx[CTX.severity]);
  const rawCategory = ctx[CTX.category];
  const category: Category = isCategory(rawCategory) ? rawCategory : 'facilities';
  const lastSegment = input.publicId.split('/').pop() || input.publicId;
  const fileName = ctx[CTX.fileName]?.trim() || `${input.fileName || lastSegment}.${input.format}`;
  const title = ctx[CTX.title] || input.fileName || lastSegment || 'Untitled capture';
  const isVideo = input.resourceType === 'video';
  const posterOffset = Number(ctx[CTX.posterOffset]);
  const ai = decodeAiContext(ctx);
  const tag = input.tag ?? DEFAULT_TAG;
  const aiTags = new Set(ai?.tags ?? []);
  const humanTags = (input.tags ?? []).filter((t) => t !== tag && !aiTags.has(t));
  const region = parseRegion(ctx[CTX.region]);

  return {
    id: `${source}-${input.cloudName}-${input.publicId}`,
    cloudName: input.cloudName,
    publicId: input.publicId,
    resourceType: input.resourceType,
    format: input.format,
    width: input.width ?? 1600,
    height: input.height ?? 900,
    bytes: input.bytes,
    duration: input.duration,
    posterOffset: isVideo ? (ctx[CTX.posterOffset] && Number.isFinite(posterOffset) && posterOffset >= 0 ? posterOffset : 1) : undefined,
    fileName,
    title,
    site: ctx[CTX.site] || 'Unassigned',
    ...(ctx[CTX.zone] ? { zone: ctx[CTX.zone] } : {}),
    ...captureOf(ctx, input.createdAt, input.now ?? Date.now()),
    capturedBy: ctx[CTX.capturedBy]?.trim() || CAPTURED_BY[source],
    tags: Array.from(new Set([...humanTags, ...(isCategory(rawCategory) ? [category] : [])])),
    source,
    collection: 'field',
    finding: severity
      ? {
          // Stable across reloads and devices: written at ingest, otherwise derived from the asset.
          id: ctx[CTX.findingId] || derivedFindingId(input.cloudName, input.publicId),
          title: ctx[CTX.findingTitle] || title,
          category,
          severity,
          status: toStatus(ctx[CTX.status]),
          summary: ctx[CTX.note] || 'Reported at ingest. Review the media and refine the record.',
          action: ctx[CTX.action] || 'No action recorded yet. Assign an owner and review the media.',
          ...(region ? { region } : {}),
        }
      : undefined,
    ...(ai ? { ai } : {}),
  };
}

/**
 * Maps a record read back from the team's cloud (GET /api/assets, Search API) onto a VisualOps record.
 * Pass the server's collection `tag` (CloudAssetsPage.tag) and the console's `now` when available.
 */
export function cloudResourceToAsset(cloudName: string, r: CloudResource, options: { tag?: string; now?: number } = {}): MediaAsset {
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
    // Records created by VisualOps carry context source=visualops (and a provenance); anything else was tagged elsewhere.
    source: r.context[CTX.source] === 'visualops' ? 'upload' : 'sync',
    tag: options.tag,
    now: options.now,
  });
}

/**
 * The same record after Cloudinary AI understood it (POST /api/assets/[id]/analyze): `ai` set, and the
 * tags auto-tagging added kept apart from the human tags. `tags` is the asset's full tag list from the response.
 */
export function withAiUnderstanding(asset: MediaAsset, ai: AiUnderstanding, tags?: string[], collectionTag = DEFAULT_TAG): MediaAsset {
  const aiTags = new Set(ai.tags);
  const base = tags ?? asset.tags;
  const human = base.filter((t) => t !== collectionTag && !aiTags.has(t));
  const category = asset.finding?.category;
  const humanTags = Array.from(new Set([...human, ...(category && asset.tags.includes(category) ? [category] : [])]));
  return { ...asset, ai, tags: humanTags };
}
