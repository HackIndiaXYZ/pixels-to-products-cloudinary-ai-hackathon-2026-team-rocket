import type { CaptureBasis, Category, Finding, FindingStatus, MediaAsset, Severity } from '@/lib/types';
import { pluralize } from '@/lib/format';

/*
 * Vocabulary used across VisualOps (console, landing preview and reports):
 *   open        — findings whose status is 'open'. The only meaning of "open".
 *   monitoring  — findings whose status is 'monitoring'.
 *   unresolved  — not yet resolved: open + monitoring.
 *   resolved    — findings whose status is 'resolved'.
 */

export const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];
export const CATEGORIES: Category[] = ['structural', 'safety', 'equipment', 'electrical', 'facilities', 'inventory'];
export const STATUSES: FindingStatus[] = ['open', 'monitoring', 'resolved'];

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };

export const CATEGORY_LABEL: Record<Category, string> = {
  structural: 'Structural',
  safety: 'Safety',
  equipment: 'Equipment',
  electrical: 'Electrical',
  facilities: 'Facilities',
  inventory: 'Inventory',
};

export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: 'Open',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

export interface FindingRecord {
  finding: Finding;
  asset: MediaAsset;
}

/** Status 'open' — the one meaning of "open" in VisualOps. */
export const isOpen = (record: FindingRecord): boolean => record.finding.status === 'open';

/** Not yet resolved: open + monitoring. */
export const isUnresolved = (record: FindingRecord): boolean => record.finding.status !== 'resolved';

export function fieldAssets(assets: MediaAsset[]): MediaAsset[] {
  return assets.filter((a) => a.collection !== 'reference');
}

/** Structured records of the field media, worst severity first, then newest first. */
export function findingRecords(assets: MediaAsset[]): FindingRecord[] {
  return fieldAssets(assets)
    .filter((a): a is MediaAsset & { finding: Finding } => Boolean(a.finding))
    .map((asset) => ({ finding: asset.finding, asset }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[b.finding.severity] - SEVERITY_RANK[a.finding.severity] ||
        +new Date(b.asset.capturedAt) - +new Date(a.asset.capturedAt),
    );
}

export function countBy<T, K extends string>(items: T[], key: (item: T) => K, keys: readonly K[]): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function severityCounts(records: FindingRecord[]): Record<Severity, number> {
  return countBy(records, (r) => r.finding.severity, SEVERITIES);
}

export interface StatusCounts {
  total: number;
  /** Status 'open'. */
  open: number;
  monitoring: number;
  resolved: number;
  /** open + monitoring. */
  unresolved: number;
}

export function statusCounts(records: FindingRecord[]): StatusCounts {
  const by = countBy(records, (r) => r.finding.status, STATUSES);
  return { total: records.length, open: by.open, monitoring: by.monitoring, resolved: by.resolved, unresolved: by.open + by.monitoring };
}

export function sitesOf(assets: MediaAsset[]): string[] {
  return Array.from(new Set(fieldAssets(assets).map((a) => a.site))).sort();
}

/**
 * How an asset's `capturedAt` was obtained. Bundled samples without an explicit basis
 * are sample-relative; uploads and syncs carry the time Cloudinary recorded.
 */
export function captureBasisOf(asset: MediaAsset): CaptureBasis {
  return asset.captureBasis ?? (asset.source === 'sample' ? 'sample-relative' : 'recorded');
}

/**
 * A short note to show next to a capture time, so sample times are never read as real
 * capture metadata: "Sample time · relative to now", "Camera time 2025-10-03 03:48:49 ·
 * burned into the footage", or undefined for times recorded by Cloudinary.
 */
export function captureTimeNote(asset: MediaAsset): string | undefined {
  switch (captureBasisOf(asset)) {
    case 'sample-relative':
      return 'Sample time · relative to now';
    case 'fixed':
      return asset.cameraTime ? `Camera time ${asset.cameraTime} · burned into the footage` : 'Time burned into the footage';
    default:
      return undefined;
  }
}

export interface MatrixCell {
  category: Category;
  severity: Severity;
  count: number;
}

export function categorySeverityMatrix(records: FindingRecord[]): MatrixCell[] {
  const cells: MatrixCell[] = [];
  for (const category of CATEGORIES) {
    for (const severity of SEVERITIES) {
      cells.push({
        category,
        severity,
        count: records.filter((r) => r.finding.category === category && r.finding.severity === severity).length,
      });
    }
  }
  return cells;
}

export interface SiteSummary {
  site: string;
  /** Every structured record at the site, whatever its status. */
  total: number;
  /** Findings with status 'open' (the console's meaning of "open"). */
  open: number;
  /** Findings with status 'monitoring'. */
  monitoring: number;
  /** Findings with status 'resolved'. */
  resolved: number;
  /** Not yet resolved: open + monitoring. */
  unresolved: number;
  /** Worst severity among unresolved findings (open or monitoring); undefined when all are resolved. */
  worst?: Severity;
  /** Worst severity among open findings; undefined when none is open. */
  worstOpen?: Severity;
  /** Unresolved findings (open + monitoring) by severity. */
  bySeverity: Record<Severity, number>;
  /** Open findings by severity. */
  openBySeverity: Record<Severity, number>;
}

const worstOf = (records: FindingRecord[]): Severity | undefined =>
  records.map((r) => r.finding.severity).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0];

/** Per-site status, ranked by worst unresolved finding, then by number unresolved. */
export function siteSummaries(records: FindingRecord[]): SiteSummary[] {
  const sites = Array.from(new Set(records.map((r) => r.asset.site)));
  return sites
    .map((site) => {
      const rs = records.filter((r) => r.asset.site === site);
      const unresolved = rs.filter(isUnresolved);
      const open = rs.filter(isOpen);
      return {
        site,
        total: rs.length,
        open: open.length,
        monitoring: unresolved.length - open.length,
        resolved: rs.length - unresolved.length,
        unresolved: unresolved.length,
        worst: worstOf(unresolved),
        worstOpen: worstOf(open),
        bySeverity: severityCounts(unresolved),
        openBySeverity: severityCounts(open),
      };
    })
    .sort(
      (a, b) =>
        (b.worst ? SEVERITY_RANK[b.worst] : 0) - (a.worst ? SEVERITY_RANK[a.worst] : 0) || b.unresolved - a.unresolved,
    );
}

/**
 * Captures per day for the last `days` days, oldest first. `critical` counts captures
 * with an unresolved (open or monitoring) high or critical finding.
 */
export function captureTimeline(assets: MediaAsset[], days: number, now: number): Array<{ day: number; count: number; critical: number }> {
  const DAY = 86_400_000;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const buckets = Array.from({ length: days }, (_, i) => ({ day: start.getTime() - (days - 1 - i) * DAY, count: 0, critical: 0 }));
  for (const a of fieldAssets(assets)) {
    const t = new Date(a.capturedAt).getTime();
    const bucket = buckets.find((b) => t >= b.day && t < b.day + DAY);
    if (bucket) {
      bucket.count += 1;
      if (a.finding && (a.finding.severity === 'critical' || a.finding.severity === 'high') && a.finding.status !== 'resolved') {
        bucket.critical += 1;
      }
    }
  }
  return buckets;
}

/* ------------------------------------------------------------------------ */
/* Command Center summary — shared by the console Overview and the landing   */
/* ------------------------------------------------------------------------ */

export interface OverviewSummary {
  /** Field media (reference samples excluded). */
  field: MediaAsset[];
  /** Every structured record, worst first. */
  records: FindingRecord[];
  /** Records with status 'open', worst first then newest. */
  open: FindingRecord[];
  counts: StatusCounts;
  /** Open findings by severity. */
  openBySeverity: Record<Severity, number>;
  /** The finding to act on first: the worst open finding (newest among equals). */
  lead?: FindingRecord;
  /** The next open findings after the lead (up to 3). */
  queue: FindingRecord[];
  /** The lead is critical or high. */
  urgent: boolean;
  /** Sites with at least one open finding. */
  openSites: number;
  /** Sites with field media. */
  siteCount: number;
  /** The site with the worst unresolved finding. */
  riskiest?: SiteSummary;
  /** "Ring Road North needs attention first." / "No critical or high findings open." / "No open findings." */
  headline: string;
  /** "9 open findings across 4 sites · 1 critical, 1 high · 15 captures on record" */
  summary: string;
}

/** How the lead is named in the headline: its site, or the finding id when the site is unassigned. */
export function leadName(record: FindingRecord): string {
  const site = record.asset.site.trim();
  return !site || site === 'Unassigned' ? record.finding.id : site;
}

/** The Command Center's headline figures, computed once for every surface that shows them. */
export function overviewSummary(assets: MediaAsset[]): OverviewSummary {
  const field = fieldAssets(assets);
  const records = findingRecords(assets);
  const open = records.filter(isOpen);
  const counts = statusCounts(records);
  const openBySeverity = severityCounts(open);
  const lead = open[0];
  const urgent = Boolean(lead && (lead.finding.severity === 'critical' || lead.finding.severity === 'high'));
  const openSites = new Set(open.map((r) => r.asset.site)).size;

  const headline = !lead ? 'No open findings.' : urgent ? `${leadName(lead)} needs attention first.` : 'No critical or high findings open.';
  const summary = [
    `${pluralize(open.length, 'open finding')} across ${pluralize(openSites, 'site')}`,
    openBySeverity.critical + openBySeverity.high > 0 ? `${openBySeverity.critical} critical, ${openBySeverity.high} high` : null,
    `${pluralize(field.length, 'capture')} on record`,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    field,
    records,
    open,
    counts,
    openBySeverity,
    lead,
    queue: open.slice(1, 4),
    urgent,
    openSites,
    siteCount: sitesOf(assets).length,
    riskiest: siteSummaries(records).find((s) => s.worst),
    headline,
    summary,
  };
}
