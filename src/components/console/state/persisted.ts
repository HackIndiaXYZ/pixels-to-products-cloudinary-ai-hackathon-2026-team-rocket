import type {
  AiObject,
  AiUnderstanding,
  Category,
  CaptureBasis,
  CloudSettings,
  Finding,
  FindingStatus,
  MediaAsset,
  Region,
  ResourceType,
  Severity,
} from '@/lib/types';
import { DEMO_CLOUD, isValidCloudName, isValidTag } from '@/lib/cloudinary/config';

/**
 * Validation for what the console reads back from localStorage (this browser's uploads and syncs, and the
 * Cloudinary settings override). Stored data is untrusted: it may be stale, from an older version, edited
 * by hand or written by another script on the origin. Every entry is rebuilt from known fields with the
 * right types and bounded sizes; anything that doesn't fit is dropped rather than repaired, and unknown
 * keys never reach the app.
 */

/** Most records kept from storage. */
export const MAX_STORED_ASSETS = 500;

const CATEGORIES: readonly Category[] = ['structural', 'safety', 'equipment', 'electrical', 'facilities', 'inventory'];
const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];
const STATUSES: readonly FindingStatus[] = ['open', 'monitoring', 'resolved'];
const RESOURCE_TYPES: readonly ResourceType[] = ['image', 'video'];
const CAPTURE_BASES: readonly CaptureBasis[] = ['sample-relative', 'fixed', 'recorded'];
/**
 * Uploads and syncs. `sample` is kept only for a team cloud's seeded records (provenance sample-annotation);
 * the bundled samples on the demo cloud come from the code, never from storage.
 */
const STORED_SOURCES = ['upload', 'sync', 'sample'] as const;
const COLLECTIONS = ['field', 'reference'] as const;

const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/;

type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A string within `max` characters, or undefined. Oversized values are rejected, not truncated. */
function text(value: unknown, max: number, { required = false, singleLine = false } = {}): string | undefined {
  if (typeof value !== 'string' || value.length > max) return undefined;
  if (singleLine && CONTROL.test(value)) return undefined;
  if (required && !value.trim()) return undefined;
  return value;
}

function num(value: unknown, min: number, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= maxLength && !CONTROL.test(item))
    .slice(0, maxItems);
}

function isoDate(value: unknown): string | undefined {
  const s = text(value, 40, { singleLine: true });
  return s && Number.isFinite(Date.parse(s)) ? s : undefined;
}

function region(value: unknown): Region | undefined {
  if (!isObj(value)) return undefined;
  const x = num(value.x, 0, 100);
  const y = num(value.y, 0, 100);
  const w = num(value.w, 0, 100);
  const h = num(value.h, 0, 100);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  const label = text(value.label, 60, { singleLine: true });
  return label ? { x, y, w, h, label } : { x, y, w, h };
}

function finding(value: unknown): Finding | undefined {
  if (!isObj(value)) return undefined;
  const id = text(value.id, 40, { required: true, singleLine: true });
  const title = text(value.title, 300, { required: true });
  const category = oneOf(value.category, CATEGORIES);
  const severity = oneOf(value.severity, SEVERITIES);
  const status = oneOf(value.status, STATUSES);
  const summary = text(value.summary, 4000);
  const action = text(value.action, 4000);
  if (!id || !title || !category || !severity || !status || summary === undefined || action === undefined) return undefined;
  const out: Finding = { id, title, category, severity, status, summary, action };
  const r = value.region === undefined ? undefined : region(value.region);
  if (r) out.region = r;
  return out;
}

function aiObject(value: unknown): AiObject | undefined {
  if (!isObj(value)) return undefined;
  const label = text(value.label, 80, { required: true, singleLine: true });
  const confidence = num(value.confidence, 0, 1);
  if (!label || confidence === undefined) return undefined;
  const box = value.box === undefined ? undefined : region(value.box);
  return box ? { label, confidence, box } : { label, confidence };
}

function ai(value: unknown): AiUnderstanding | undefined {
  if (!isObj(value)) return undefined;
  const objects = Array.isArray(value.objects)
    ? value.objects.slice(0, 50).map(aiObject).filter((o): o is AiObject => o !== undefined)
    : [];
  const out: AiUnderstanding = { objects, tags: stringList(value.tags, 50, 80) ?? [] };
  const caption = text(value.caption, 1000);
  const model = text(value.model, 200, { singleLine: true });
  const analyzedAt = isoDate(value.analyzedAt);
  if (caption) out.caption = caption;
  if (model) out.model = model;
  if (analyzedAt) out.analyzedAt = analyzedAt;
  return out;
}

/** One stored record, rebuilt from its known fields; null when it is not a valid upload/sync record. */
export function parseStoredAsset(value: unknown): MediaAsset | null {
  if (!isObj(value)) return null;
  const id = text(value.id, 600, { required: true, singleLine: true });
  const cloudName = typeof value.cloudName === 'string' && isValidCloudName(value.cloudName) ? value.cloudName.trim() : undefined;
  const publicId = text(value.publicId, 512, { required: true, singleLine: true });
  const resourceType = oneOf(value.resourceType, RESOURCE_TYPES);
  const format = typeof value.format === 'string' && /^[a-z0-9]{1,10}$/i.test(value.format) ? value.format : undefined;
  const width = num(value.width, 1, 100_000);
  const height = num(value.height, 1, 100_000);
  const fileName = text(value.fileName, 300, { singleLine: true });
  const title = text(value.title, 300);
  const site = text(value.site, 200, { singleLine: true });
  const capturedAt = isoDate(value.capturedAt);
  const capturedBy = text(value.capturedBy, 200, { singleLine: true });
  const tags = stringList(value.tags, 60, 100);
  const storedSource = oneOf(value.source, STORED_SOURCES);
  const source = storedSource === 'sample' && cloudName === DEMO_CLOUD ? undefined : storedSource;
  if (
    !id ||
    !cloudName ||
    !publicId ||
    !resourceType ||
    !format ||
    width === undefined ||
    height === undefined ||
    fileName === undefined ||
    title === undefined ||
    site === undefined ||
    !capturedAt ||
    capturedBy === undefined ||
    !tags ||
    !source
  ) {
    return null;
  }

  const asset: MediaAsset = { id, cloudName, publicId, resourceType, format, width, height, fileName, title, site, capturedAt, capturedBy, tags, source };
  const bytes = num(value.bytes, 0, Number.MAX_SAFE_INTEGER);
  const duration = num(value.duration, 0, 24 * 3600);
  const posterOffset = num(value.posterOffset, 0, 24 * 3600);
  const zone = text(value.zone, 200, { singleLine: true });
  const captureBasis = oneOf(value.captureBasis, CAPTURE_BASES);
  const cameraTime = text(value.cameraTime, 40, { singleLine: true });
  const collection = oneOf(value.collection, COLLECTIONS);
  const f = value.finding === undefined ? undefined : finding(value.finding);
  const a = value.ai === undefined ? undefined : ai(value.ai);
  if (bytes !== undefined) asset.bytes = bytes;
  if (duration !== undefined) asset.duration = duration;
  if (posterOffset !== undefined) asset.posterOffset = posterOffset;
  if (zone) asset.zone = zone;
  if (captureBasis) asset.captureBasis = captureBasis;
  if (cameraTime) asset.cameraTime = cameraTime;
  if (collection) asset.collection = collection;
  if (f) asset.finding = f;
  if (a) asset.ai = a;
  return asset;
}

/** The stored record list: valid entries only, first copy of each id, at most MAX_STORED_ASSETS. */
export function parseStoredAssets(value: unknown): MediaAsset[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: MediaAsset[] = [];
  for (const entry of value) {
    const asset = parseStoredAsset(entry);
    if (!asset || seen.has(asset.id)) continue;
    seen.add(asset.id);
    out.push(asset);
    if (out.length >= MAX_STORED_ASSETS) break;
  }
  return out;
}

/** The stored settings override, or null (use the build-time settings) when it is missing or invalid. */
export function parseStoredSettings(value: unknown): CloudSettings | null {
  if (!isObj(value)) return null;
  const { cloudName, uploadPreset, tag } = value;
  if (typeof cloudName !== 'string' || !isValidCloudName(cloudName)) return null;
  if (typeof tag !== 'string' || !isValidTag(tag)) return null;
  if (typeof uploadPreset !== 'string' || !/^[\w-]{0,80}$/.test(uploadPreset.trim())) return null;
  return { cloudName: cloudName.trim(), uploadPreset: uploadPreset.trim(), tag: tag.trim() };
}
