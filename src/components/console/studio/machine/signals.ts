import type { AiUnderstanding, MediaAsset, Region } from '@/lib/types';
import { aiSearchText } from '@/lib/cloudinary/ai';
import { cropCentre, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import type { Integrity } from '@/lib/cloudinary/pipeline';
import { parseQuery, runQuery } from '@/lib/search/query';

/**
 * Local stages of the pipeline machine (CLASSIFY and INDEX).
 *
 * Nothing here is inferred by a model we do not run. Every label says where it came from:
 *  - human:  the record's own classification (severity, category, status, site, tags), entered at
 *            ingest or team-written for the sample workspace;
 *  - ai:     what Cloudinary's AI reported — AI Content Analysis (auto-tags, detected objects) and
 *            fl_getinfo (face detections, where g_auto placed its 1:1 crop);
 *  - system: what VisualOps measured or derived — stored format, frame orientation, media type and
 *            the pipeline's integrity class.
 * INDEX runs the console's real search over the real record set and reports where this record ranks.
 */

export type TagSource = 'human' | 'ai' | 'system';

export interface DerivedTag {
  tag: string;
  source: TagSource;
}

export const TAG_SOURCES: TagSource[] = ['human', 'ai', 'system'];

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
  signals: { insight?: CloudinaryInsight; ai?: AiUnderstanding; storedFormat?: string; integrity: Integrity },
): DerivedTag[] {
  const out: DerivedTag[] = [];
  const seen = new Set<string>();
  const add = (tag: string, source: TagSource) => {
    const t = tag.trim().toLowerCase();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push({ tag: t, source });
  };

  // Human classification: the record's own fields.
  const f = asset.finding;
  if (f) {
    add(`severity:${f.severity}`, 'human');
    add(`category:${f.category}`, 'human');
    add(`status:${f.status}`, 'human');
  }
  if (asset.site) add(`site:${slug(asset.site)}`, 'human');
  const { ai, insight } = signals;
  const autoTags = new Set((ai?.tags ?? []).map((t) => t.toLowerCase()));
  asset.tags.filter((t) => !autoTags.has(t.toLowerCase())).forEach((t) => add(t, 'human'));

  // AI detected: Cloudinary's auto-tags and detected objects, then its fl_getinfo signals.
  ai?.tags.forEach((t) => add(t, 'ai'));
  ai?.objects.forEach((o) => add(o.label, 'ai'));
  if (insight) {
    add(`faces:${insight.faces.length}`, 'ai');
    if (insight.focus) add(`gauto-crop:${cropPosition(insight.focus)}`, 'ai');
  }

  // System derived: measured or computed here.
  if (signals.storedFormat) add(`format:${signals.storedFormat}`, 'system');
  if (insight && insight.inputWidth > 1 && insight.inputHeight > 1) {
    add(`orientation:${insight.inputWidth >= insight.inputHeight ? 'landscape' : 'portrait'}`, 'system');
  }
  add(`type:${asset.resourceType}`, 'system');
  add(`integrity:${signals.integrity}`, 'system');
  return out;
}

const tokens = (text: string) => text.toLowerCase().split(/[\s·,/()|;:.]+/).filter((t) => t.length > 1);

/**
 * Distinct terms the console search can match for this record — the same fields `runQuery`
 * matches keywords against: the human-classified descriptors, and Cloudinary's AI understanding
 * (caption, detected objects, auto-tags) when the record has one.
 */
export function searchableTerms(asset: MediaAsset): { human: number; ai: number } {
  const f = asset.finding;
  const autoTags = new Set((asset.ai?.tags ?? []).map((t) => t.toLowerCase()));
  const humanFields = [
    ...asset.tags.filter((t) => !autoTags.has(t.toLowerCase())),
    asset.title,
    asset.fileName,
    asset.site,
    asset.zone ?? '',
    f?.title ?? '',
    f?.id ?? '',
    f?.category ?? '',
  ];
  const human = new Set(humanFields.flatMap(tokens));
  const ai = new Set(aiSearchText(asset.ai).flatMap(tokens).filter((t) => !human.has(t)));
  return { human: human.size, ai: ai.size };
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
  // This run's copy of the record (it may carry AI understanding the pool's copy does not have yet).
  const pool = [asset, ...assets.filter((a) => a.id !== asset.id)];
  const { hits } = runQuery(parseQuery(query, sites, now), pool);
  const index = hits.findIndex((h) => h.asset.id === asset.id);
  return { query, rank: index === -1 ? null : index + 1, total: hits.length };
}
