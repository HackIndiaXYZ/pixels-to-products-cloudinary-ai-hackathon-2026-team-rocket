import type { AssetSource, Category, FindingStatus, MediaAsset, ResourceType, Severity } from '@/lib/types';
import {
  SEVERITIES,
  SEVERITY_RANK,
  captureBasisOf,
  captureTimeNote,
  fieldAssets,
  isOpen,
  isUnresolved,
  type FindingRecord,
  type StatusCounts,
} from '@/lib/analytics';
import { formatDateTime, relativeTime } from '@/lib/format';

/**
 * Pure helpers for the Incidents view. Everything here derives from the
 * structured records in the console store — no invented numbers.
 *
 * Status vocabulary is the one shared with the Overview, the landing preview
 * and reports (see lib/analytics): "open" is status 'open' only; "unresolved"
 * is open + monitoring.
 */

export const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export type StatusFilter = 'open' | 'unresolved' | 'monitoring' | 'resolved' | 'all';

export interface IncidentFilters {
  severities: Severity[];
  category: 'all' | Category;
  site: string;
  window: string;
  media: 'all' | ResourceType;
  status: StatusFilter;
}

/**
 * Opens on status 'open', so "in view", the sidebar badge and the Overview's
 * "Open findings" figure are the same number.
 */
export const DEFAULT_FILTERS: IncidentFilters = {
  severities: [],
  category: 'all',
  site: 'all',
  window: 'all',
  media: 'all',
  status: 'open',
};

/**
 * Status filter choices, in menu order. `count` picks the matching figure from `statusCounts`.
 * Labels stay short: a native select is as wide as its longest option.
 */
export const STATUS_FILTERS: Array<{ value: StatusFilter; label: string; count: keyof StatusCounts }> = [
  { value: 'open', label: 'Open', count: 'open' },
  { value: 'unresolved', label: 'Unresolved', count: 'unresolved' },
  { value: 'monitoring', label: 'Monitoring', count: 'monitoring' },
  { value: 'resolved', label: 'Resolved', count: 'resolved' },
  { value: 'all', label: 'All statuses', count: 'total' },
];

export function matchesStatus(record: FindingRecord, status: StatusFilter): boolean {
  switch (status) {
    case 'all':
      return true;
    case 'open':
      return isOpen(record);
    case 'unresolved':
      return isUnresolved(record);
    default:
      return record.finding.status === (status satisfies FindingStatus);
  }
}

export interface StatusWiden {
  /** The status filter that brings the hidden findings into view. */
  target: StatusFilter;
  /** Button label, e.g. 'Show unresolved'. */
  label: string;
  /** e.g. 'No open findings in this view. 2 monitoring findings match every other filter.' */
  text: string;
}

const STATUS_WORD: Record<StatusFilter, string> = {
  open: 'open',
  unresolved: 'unresolved',
  monitoring: 'monitoring',
  resolved: 'resolved',
  all: '',
};

/**
 * When the status filter alone empties the view, what it hides and how to show
 * it; null when the view is not empty or other filters are the cause.
 * `counts` must be taken within every filter except status.
 */
export function statusWiden(status: StatusFilter, counts: StatusCounts, inView: number): StatusWiden | null {
  if (inView > 0 || status === 'all' || counts.total === 0) return null;
  const hidden = (['open', 'monitoring', 'resolved'] as const).filter((s) => counts[s] > 0);
  const n = hidden.reduce((sum, s) => sum + counts[s], 0);
  const list = hidden.map((s) => `${counts[s]} ${s}`).join(' and ');
  const target: StatusFilter = counts.unresolved > 0 && status !== 'unresolved' ? 'unresolved' : 'all';
  return {
    target,
    label: target === 'unresolved' ? 'Show unresolved' : 'Show all statuses',
    text: `No ${STATUS_WORD[status]} findings in this view. ${list} ${n === 1 ? 'finding matches' : 'findings match'} every other filter.`,
  };
}

export const WINDOWS: Array<{ value: string; label: string; days: number | null }> = [
  { value: 'all', label: 'Any time', days: null },
  { value: '1', label: 'Last 24 hours', days: 1 },
  { value: '7', label: 'Last 7 days', days: 7 },
  { value: '30', label: 'Last 30 days', days: 30 },
];

const DAY = 86_400_000;

export function filtersActive(f: IncidentFilters): boolean {
  return (
    f.severities.length > 0 ||
    f.category !== DEFAULT_FILTERS.category ||
    f.site !== DEFAULT_FILTERS.site ||
    f.window !== DEFAULT_FILTERS.window ||
    f.media !== DEFAULT_FILTERS.media ||
    f.status !== DEFAULT_FILTERS.status
  );
}

/** Every filter except severity and status; the base the scoped counts are taken from. */
export function inBaseScope(record: FindingRecord, f: Omit<IncidentFilters, 'severities' | 'status'>, now: number): boolean {
  const { finding, asset } = record;
  if (f.category !== 'all' && finding.category !== f.category) return false;
  if (f.site !== 'all' && asset.site !== f.site) return false;
  if (f.media !== 'all' && asset.resourceType !== f.media) return false;
  const days = WINDOWS.find((w) => w.value === f.window)?.days ?? null;
  if (days !== null && now - new Date(asset.capturedAt).getTime() > days * DAY) return false;
  return true;
}

/** Every filter except severity — the scope the severity toggles and the matrix count within. */
export function inScope(record: FindingRecord, f: Omit<IncidentFilters, 'severities'>, now: number): boolean {
  return matchesStatus(record, f.status) && inBaseScope(record, f, now);
}

export interface LeadPick {
  record: FindingRecord;
  /** Which status the lead was chosen from: open first, monitoring only when nothing is open. */
  basis: 'open' | 'monitoring';
}

function mostSevere(records: FindingRecord[]): FindingRecord | undefined {
  let best: FindingRecord | undefined;
  for (const r of records) {
    if (
      !best ||
      SEVERITY_RANK[r.finding.severity] > SEVERITY_RANK[best.finding.severity] ||
      (SEVERITY_RANK[r.finding.severity] === SEVERITY_RANK[best.finding.severity] &&
        +new Date(r.asset.capturedAt) > +new Date(best.asset.capturedAt))
    ) {
      best = r;
    }
  }
  return best;
}

/** The most severe open finding in view (newest capture breaks ties); falls back to monitored ones. */
export function pickLead(records: FindingRecord[]): LeadPick | null {
  const open = mostSevere(records.filter(isOpen));
  if (open) return { record: open, basis: 'open' };
  const monitoring = mostSevere(records.filter((r) => r.finding.status === 'monitoring'));
  return monitoring ? { record: monitoring, basis: 'monitoring' } : null;
}

export interface SeverityGroup {
  severity: Severity;
  records: FindingRecord[];
}

/** Non-empty groups in severity order (critical → low); record order is preserved. */
export function groupBySeverity(records: FindingRecord[]): SeverityGroup[] {
  return SEVERITIES.map((severity) => ({ severity, records: records.filter((r) => r.finding.severity === severity) })).filter(
    (g) => g.records.length > 0,
  );
}

/** First sentence of an annotation ("4.2" or "1,000" never end a sentence). */
export function firstSentence(text: string): string {
  const match = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (match ? match[0] : text).trim();
}

/** Field media recorded at `site` whose finding shares `category`. */
export function evidenceAtSite(
  assets: MediaAsset[],
  site: string,
  category: Category,
): { total: number; photos: number; videos: number } {
  const matching = fieldAssets(assets).filter((a) => a.site === site && a.finding?.category === category);
  const videos = matching.filter((a) => a.resourceType === 'video').length;
  return { total: matching.length, photos: matching.length - videos, videos };
}

const PROVENANCE: Record<AssetSource, { one: string; many: string }> = {
  sample: { one: 'Sample annotation', many: 'Sample annotations' },
  upload: { one: 'Recorded at ingest', many: 'Recorded at ingest' },
  sync: { one: 'From Cloudinary context', many: 'From Cloudinary context' },
};

/**
 * Where a finding's words came from — shown wherever findings are described:
 * 'Sample annotation' (bundled dataset), 'Recorded at ingest' (uploaded in
 * VisualOps) or 'From Cloudinary context' (synced from the cloud's context metadata).
 */
export function provenanceLabel(asset: MediaAsset): string {
  return (PROVENANCE[asset.source] ?? PROVENANCE.sample).one;
}

/** Short provenance note for a set of records, e.g. 'Sample annotations' or 'Sample annotations · Recorded at ingest'. */
export function provenanceSummary(records: FindingRecord[]): string {
  const sources = new Set(records.map((r) => r.asset.source));
  return (Object.keys(PROVENANCE) as AssetSource[])
    .filter((s) => sources.has(s))
    .map((s) => PROVENANCE[s].many)
    .join(' · ');
}

export interface CaptureWhen {
  /** '5h ago'; a camera-clock capture gives its own date instead. */
  relative: string;
  /** The absolute time to print: the local date/time, or the camera clock verbatim. */
  absolute: string;
  /** Why this time should not be read as recorded capture metadata, when it should not. */
  note?: string;
  /** Hover text: the absolute time plus the note. */
  title: string;
}

/**
 * How to show when a capture was made, honestly: bundled samples carry times
 * relative to now, a camera-clock capture shows the burned-in text verbatim
 * (its zone is unknown, so it is never converted), and uploads and syncs show
 * the time Cloudinary recorded.
 */
export function captureWhen(asset: MediaAsset, now: number): CaptureWhen {
  const note = captureTimeNote(asset);
  if (captureBasisOf(asset) === 'fixed' && asset.cameraTime) {
    // The note already quotes the camera time.
    return { relative: asset.cameraTime.slice(0, 10), absolute: asset.cameraTime, note, title: note ?? asset.cameraTime };
  }
  const absolute = formatDateTime(asset.capturedAt);
  return { relative: relativeTime(asset.capturedAt, now), absolute, note, title: note ? `${absolute} · ${note}` : absolute };
}
