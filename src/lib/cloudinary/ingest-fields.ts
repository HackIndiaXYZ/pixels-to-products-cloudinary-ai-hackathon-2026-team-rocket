import type { Category, Severity } from '@/lib/types';

/**
 * The record fields VisualOps stores on a Cloudinary asset as contextual metadata.
 * Shared by the browser (what it asks for) and the signing route (what it agrees to sign),
 * so both sides validate the same way. Cloudinary is the system of record: these values
 * travel with the asset and are read back by the Search API.
 */

export const CONTEXT_CATEGORIES: Category[] = ['structural', 'safety', 'equipment', 'electrical', 'facilities', 'inventory'];
export const CONTEXT_SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

export interface IngestContext {
  title?: string;
  site?: string;
  category?: string;
  severity?: string;
  note?: string;
  finding_id?: string;
  source?: string;
}

const LIMITS: Record<keyof IngestContext, number> = {
  title: 120,
  site: 60,
  category: 20,
  severity: 10,
  note: 200,
  finding_id: 24,
  source: 20,
};

const FINDING_ID = /^VO-[A-Z0-9-]{3,20}$/;
// Control characters are rejected by Cloudinary context values; strip them.
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/** Keeps only known keys with valid, trimmed, length-limited values. */
export function sanitizeIngestContext(input: unknown): IngestContext {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out: IngestContext = {};
  for (const key of Object.keys(LIMITS) as (keyof IngestContext)[]) {
    const raw = source[key];
    if (typeof raw !== 'string') continue;
    const value = raw.replace(CONTROL, '').trim().slice(0, LIMITS[key]);
    if (!value) continue;
    if (key === 'category' && !CONTEXT_CATEGORIES.includes(value as Category)) continue;
    if (key === 'severity' && !CONTEXT_SEVERITIES.includes(value as Severity)) continue;
    if (key === 'finding_id' && !FINDING_ID.test(value)) continue;
    if (key === 'source' && value !== 'visualops') continue;
    out[key] = value;
  }
  return out;
}

const TAG = /^[a-z0-9][a-z0-9_-]{0,62}$/i;

/** Valid, de-duplicated tags (at most 10). */
export function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const tags = input
    .filter((t): t is string => typeof t === 'string')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => TAG.test(t));
  return Array.from(new Set(tags)).slice(0, 10);
}

const escapeContext = (value: string) => value.replace(/([=|])/g, '\\$1');

/** Cloudinary's `key=value|key=value` context format, with `=` and `|` escaped as documented. */
export function encodeContext(fields: Record<string, string | undefined>): string {
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${escapeContext(String(v))}`)
    .join('|');
}

/** A new finding id for a record created at ingest, e.g. VO-U7K2QF. */
export function newFindingId(): string {
  const time = Date.now().toString(36).toUpperCase().slice(-5);
  const rand = Math.floor(Math.random() * 36 ** 2).toString(36).toUpperCase().padStart(2, '0');
  return `VO-U${time}${rand}`;
}

/** A stable finding id derived from the asset, for records that were not given one at ingest. */
export function derivedFindingId(cloudName: string, publicId: string): string {
  let h = 2166136261;
  for (const ch of `${cloudName}/${publicId}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return `VO-C${(h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(0, 6)}`;
}
