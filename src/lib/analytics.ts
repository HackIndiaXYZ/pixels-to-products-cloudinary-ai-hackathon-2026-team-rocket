import type { Category, Finding, FindingStatus, MediaAsset, Severity } from '@/lib/types';

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

export function fieldAssets(assets: MediaAsset[]): MediaAsset[] {
  return assets.filter((a) => a.collection !== 'reference');
}

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

export function sitesOf(assets: MediaAsset[]): string[] {
  return Array.from(new Set(fieldAssets(assets).map((a) => a.site))).sort();
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
  total: number;
  open: number;
  worst?: Severity;
  bySeverity: Record<Severity, number>;
}

export function siteSummaries(records: FindingRecord[]): SiteSummary[] {
  const sites = Array.from(new Set(records.map((r) => r.asset.site)));
  return sites
    .map((site) => {
      const rs = records.filter((r) => r.asset.site === site);
      const open = rs.filter((r) => r.finding.status !== 'resolved');
      const worst = open.map((r) => r.finding.severity).sort((a, b) => SEVERITY_RANK[b] - SEVERITY_RANK[a])[0];
      return { site, total: rs.length, open: open.length, worst, bySeverity: severityCounts(open) };
    })
    .sort((a, b) => (b.worst ? SEVERITY_RANK[b.worst] : 0) - (a.worst ? SEVERITY_RANK[a.worst] : 0) || b.open - a.open);
}

/** Captures per day for the last `days` days, oldest first. */
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
