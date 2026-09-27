import type { MediaAsset, Region } from '@/lib/types';
import { cropCentre, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import type { Integrity } from '@/lib/cloudinary/pipeline';
import { parseQuery, runQuery } from '@/lib/search/query';

/**
 * Local stages of the pipeline machine (TAG and INDEX).
 *
 * Nothing here is inferred by a model we do not run: tags come from the
 * record itself, from what Cloudinary reported in this run (stored format,
 * fl_getinfo face detections and where g_auto placed its 1:1 crop) and from the
 * pipeline's own integrity class. INDEX runs the console's real search over
 * the real record set and reports where this record ranks.
 */

export type TagSource = 'record' | 'cloudinary' | 'pipeline';

export interface DerivedTag {
  tag: string;
  source: TagSource;
}

const slug = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * Where g_auto placed its crop window, in thirds along the axis it could move
 * on: "left" / "centre" / "right" across a landscape frame, "top" / "centre" /
 * "bottom" down a portrait one. The window's size follows the requested aspect
 * ratio, so the position is the only content signal it carries.
 */
export function cropPosition(focus: Region): string {
  const { axis, pct } = cropCentre(focus);
  const third = pct < 100 / 3 ? 0 : pct > 200 / 3 ? 2 : 1;
  return (axis === 'x' ? ['left', 'centre', 'right'] : ['top', 'centre', 'bottom'])[third];
}

export function deriveTags(
  asset: MediaAsset,
  signals: { insight?: CloudinaryInsight; storedFormat?: string; integrity: Integrity },
): DerivedTag[] {
  const out: DerivedTag[] = [];
  const seen = new Set<string>();
  const add = (tag: string, source: TagSource) => {
    const t = tag.trim().toLowerCase();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push({ tag: t, source });
  };

  // Cloudinary signals first — they are what this run actually measured.
  const { insight } = signals;
  if (insight) {
    add(`faces:${insight.faces.length}`, 'cloudinary');
    if (insight.focus) add(`gauto-crop:${cropPosition(insight.focus)}`, 'cloudinary');
    if (insight.inputWidth > 1 && insight.inputHeight > 1) {
      add(`orientation:${insight.inputWidth >= insight.inputHeight ? 'landscape' : 'portrait'}`, 'cloudinary');
    }
  }
  if (signals.storedFormat) add(`format:${signals.storedFormat}`, 'cloudinary');

  add(`integrity:${signals.integrity}`, 'pipeline');

  const f = asset.finding;
  if (f) {
    add(`severity:${f.severity}`, 'record');
    add(`category:${f.category}`, 'record');
    add(`status:${f.status}`, 'record');
  }
  add(`type:${asset.resourceType}`, 'record');
  if (asset.site) add(`site:${slug(asset.site)}`, 'record');
  asset.tags.forEach((t) => add(t, 'record'));
  return out;
}

/**
 * Distinct terms the console search can match for this record — the same
 * descriptor fields `runQuery` matches keywords against.
 */
export function searchableTerms(asset: MediaAsset): number {
  const f = asset.finding;
  const fields = [...asset.tags, asset.title, asset.fileName, asset.site, asset.zone ?? '', f?.title ?? '', f?.category ?? ''];
  const terms = new Set<string>();
  for (const field of fields) {
    for (const token of field.toLowerCase().split(/[\s·,/()]+/)) {
      if (token.length > 1) terms.add(token);
    }
  }
  return terms.size;
}

export interface RetrievalCheck {
  query: string;
  /** 1-based rank of the record in the results, or null when it is not returned. */
  rank: number | null;
  total: number;
}

/** Runs the console's own search with a query built from the record and reports its rank. */
export function verifyRetrieval(asset: MediaAsset, assets: MediaAsset[], now: number): RetrievalCheck {
  const descriptor = asset.tags.find((t) => t.length > 2) ?? asset.title.split(/\s+/)[0] ?? asset.fileName;
  const query = [asset.finding?.severity, descriptor].filter(Boolean).join(' ');
  const sites = Array.from(new Set(assets.map((a) => a.site)));
  const { hits } = runQuery(parseQuery(query, sites, now), assets);
  const index = hits.findIndex((h) => h.asset.id === asset.id);
  return { query, rank: index === -1 ? null : index + 1, total: hits.length };
}
