import type { Category, MediaAsset, ResourceType, Severity } from '@/lib/types';
import { CATEGORIES, CATEGORY_LABEL, SEVERITIES, SEVERITY_RANK, captureBasisOf, fieldAssets } from '@/lib/analytics';
import { formatDateTime, relativeTime } from '@/lib/format';

/** Library filter state and the pure functions that apply it. */

export type TypeFilter = 'all' | ResourceType;
export type SourceFilter = 'all' | 'sample' | 'upload' | 'sync' | 'reference';
export type SortOrder = 'newest' | 'oldest' | 'severity';

export interface LibraryFilters {
  query: string;
  type: TypeFilter;
  /** Empty = every severity. */
  severities: Severity[];
  category: 'all' | Category;
  site: string;
  source: SourceFilter;
}

export const DEFAULT_FILTERS: LibraryFilters = {
  query: '',
  type: 'all',
  severities: [],
  category: 'all',
  site: 'all',
  source: 'all',
};

export const SOURCE_LABEL: Record<SourceFilter, string> = {
  all: 'All sources',
  sample: 'Sample dataset',
  upload: 'Uploaded here',
  sync: 'Synced from Cloudinary',
  reference: 'Cloudinary sample assets',
};

export const SORT_LABEL: Record<SortOrder, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  severity: 'Severity',
};

/** Field media by default; the reference collection only when asked for. */
export function poolFor(assets: MediaAsset[], source: SourceFilter): MediaAsset[] {
  return source === 'reference' ? assets.filter((a) => a.collection === 'reference') : fieldAssets(assets);
}

function haystack(asset: MediaAsset): string {
  const f = asset.finding;
  return [
    asset.title,
    asset.fileName,
    asset.site,
    asset.zone ?? '',
    asset.capturedBy,
    f?.title ?? '',
    f?.id ?? '',
    f ? CATEGORY_LABEL[f.category] : '',
    f?.severity ?? '',
    ...asset.tags,
  ]
    .join(' ')
    .toLowerCase();
}

export function matchesText(asset: MediaAsset, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = haystack(asset);
  return terms.every((term) => hay.includes(term));
}

type Facet = 'type' | 'severity' | 'category' | 'site';

/** Whether `asset` passes every filter, optionally ignoring one facet (for facet counts). */
export function matches(asset: MediaAsset, f: LibraryFilters, ignore?: Facet): boolean {
  if (ignore !== 'type' && f.type !== 'all' && asset.resourceType !== f.type) return false;
  if (ignore !== 'severity' && f.severities.length && (!asset.finding || !f.severities.includes(asset.finding.severity))) return false;
  if (ignore !== 'category' && f.category !== 'all' && asset.finding?.category !== f.category) return false;
  if (ignore !== 'site' && f.site !== 'all' && asset.site !== f.site) return false;
  if (f.source !== 'all' && f.source !== 'reference' && asset.source !== f.source) return false;
  return matchesText(asset, f.query);
}

export interface FacetCounts {
  type: Record<TypeFilter, number>;
  severity: Record<Severity, number>;
  category: Record<Category, number>;
  site: Record<string, number>;
}

/** How many results each option would give with every other filter held. */
export function facetCounts(pool: MediaAsset[], f: LibraryFilters): FacetCounts {
  const out: FacetCounts = {
    type: { all: 0, image: 0, video: 0 },
    severity: Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>,
    category: Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>,
    site: {},
  };
  for (const a of pool) {
    if (matches(a, f, 'type')) {
      out.type.all += 1;
      out.type[a.resourceType] += 1;
    }
    if (a.finding && matches(a, f, 'severity')) out.severity[a.finding.severity] += 1;
    if (a.finding && matches(a, f, 'category')) out.category[a.finding.category] += 1;
    if (matches(a, f, 'site')) out.site[a.site] = (out.site[a.site] ?? 0) + 1;
  }
  return out;
}

const capturedAt = (a: MediaAsset) => new Date(a.capturedAt).getTime();

export function sortAssets(list: MediaAsset[], order: SortOrder): MediaAsset[] {
  const out = list.slice();
  if (order === 'oldest') return out.sort((a, b) => capturedAt(a) - capturedAt(b));
  if (order === 'severity') {
    const rank = (a: MediaAsset) => (a.finding ? SEVERITY_RANK[a.finding.severity] : 0);
    return out.sort((a, b) => rank(b) - rank(a) || capturedAt(b) - capturedAt(a));
  }
  return out.sort((a, b) => capturedAt(b) - capturedAt(a));
}

export function activeFilterCount(f: LibraryFilters): number {
  return [
    f.query.trim() !== '',
    f.type !== 'all',
    f.severities.length > 0,
    f.category !== 'all',
    f.site !== 'all',
    f.source !== 'all',
  ].filter(Boolean).length;
}

/** Plain-language summary of active filters, for the empty state. */
export function describeFilters(f: LibraryFilters): string[] {
  const parts: string[] = [];
  if (f.query.trim()) parts.push(`“${f.query.trim()}”`);
  if (f.type !== 'all') parts.push(f.type === 'image' ? 'Photos' : 'Videos');
  if (f.severities.length) parts.push(f.severities.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' or '));
  if (f.category !== 'all') parts.push(CATEGORY_LABEL[f.category]);
  if (f.site !== 'all') parts.push(f.site);
  if (f.source !== 'all') parts.push(SOURCE_LABEL[f.source]);
  return parts;
}

/**
 * The capture time as the Library shows it. A fixed sample (CCTV) shows the
 * time burned into the footage exactly as the camera printed it, never a
 * converted instant; everything else shows the local date-time and how long
 * ago it was. `detail` is the short qualifier printed after the time;
 * `camera` is true when `time` is the camera's own clock.
 */
export function captureTimeDisplay(asset: MediaAsset, now: number): { time: string; detail: string; camera: boolean } {
  if (captureBasisOf(asset) === 'fixed' && asset.cameraTime) return { time: asset.cameraTime, detail: 'camera time', camera: true };
  return { time: formatDateTime(asset.capturedAt), detail: relativeTime(asset.capturedAt, now), camera: false };
}

/** True when any of `assets` carries a sample time materialised relative to the viewer's clock. */
export function hasSampleTimes(assets: MediaAsset[]): boolean {
  return assets.some((a) => captureBasisOf(a) === 'sample-relative');
}

/** Record tags that say people are in frame, so zero face detections deserves a warning rather than silence. */
const PEOPLE_TAGS = new Set(['people', 'person', 'persons', 'crew', 'worker', 'workers', 'staff', 'pedestrian', 'pedestrians']);

/** Whether the record's (human-written) tags say people are in frame. */
export function recordsPeople(asset: MediaAsset): boolean {
  return asset.tags.some((t) => PEOPLE_TAGS.has(t.toLowerCase()));
}
