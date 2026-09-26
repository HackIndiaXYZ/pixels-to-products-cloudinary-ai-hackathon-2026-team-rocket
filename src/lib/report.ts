import type { FindingStatus, MediaAsset, Severity } from '@/lib/types';
import {
  CATEGORY_LABEL,
  SEVERITIES,
  SEVERITY_RANK,
  STATUS_LABEL,
  fieldAssets,
  findingRecords,
  severityCounts,
  type FindingRecord,
} from '@/lib/analytics';
import { formatBytes, formatDateTime, isoDay } from '@/lib/format';
import { refOf, stillBase } from '@/lib/cloudinary/media';
import { STEP_DEFINITIONS } from '@/lib/cloudinary/pipeline';
import { component, deliveryUrl } from '@/lib/cloudinary/url';
import type { DeliveryMetrics } from '@/lib/cloudinary/probe';

export type ReportKind = 'inspection' | 'incident' | 'media' | 'asset';

export const REPORT_KINDS: Array<{ kind: ReportKind; name: string; description: string }> = [
  { kind: 'inspection', name: 'Inspection report', description: 'Every finding in scope with stamped evidence and actions.' },
  { kind: 'incident', name: 'Incident summary', description: 'Open and monitored issues, worst first, with age.' },
  { kind: 'media', name: 'Media analysis report', description: 'Formats, sizes, measured Cloudinary delivery and AI signals.' },
  { kind: 'asset', name: 'Asset summary', description: 'What media exists, where, and of what type.' },
];

export interface ReportScope {
  sites: string[];
  minSeverity: Severity;
  statuses: FindingStatus[];
  windowDays: number | null;
  /** Explicit asset IDs, e.g. from an Ask VisualOps result set. */
  assetIds: string[] | null;
  redactFaces: boolean;
}

export const DEFAULT_SCOPE: ReportScope = {
  sites: [],
  minSeverity: 'low',
  statuses: ['open', 'monitoring', 'resolved'],
  windowDays: null,
  assetIds: null,
  redactFaces: true,
};

export interface ReportModel {
  kind: ReportKind;
  title: string;
  generatedAt: string;
  scopeLabel: string;
  assets: MediaAsset[];
  records: FindingRecord[];
  counts: Record<Severity, number>;
  openCount: number;
  scope: ReportScope;
}

export function scopeAssets(assets: MediaAsset[], scope: ReportScope, now: number): MediaAsset[] {
  return fieldAssets(assets).filter((a) => {
    if (scope.assetIds && !scope.assetIds.includes(a.id)) return false;
    if (scope.sites.length && !scope.sites.includes(a.site)) return false;
    if (scope.windowDays !== null && now - new Date(a.capturedAt).getTime() > scope.windowDays * 86_400_000) return false;
    return true;
  });
}

export function buildReport(kind: ReportKind, assets: MediaAsset[], scope: ReportScope, now: number): ReportModel {
  const inScope = scopeAssets(assets, scope, now);
  let records = findingRecords(inScope).filter(
    (r) => SEVERITY_RANK[r.finding.severity] >= SEVERITY_RANK[scope.minSeverity] && scope.statuses.includes(r.finding.status),
  );
  if (kind === 'incident') records = records.filter((r) => r.finding.status !== 'resolved');

  const parts: string[] = [];
  parts.push(scope.assetIds ? `${scope.assetIds.length} selected assets` : scope.sites.length ? scope.sites.join(', ') : 'All sites');
  if (scope.windowDays !== null) parts.push(`last ${scope.windowDays} days`);
  if (scope.minSeverity !== 'low') parts.push(`${scope.minSeverity} and above`);

  const name = REPORT_KINDS.find((k) => k.kind === kind)!.name;
  return {
    kind,
    title: name,
    generatedAt: new Date(now).toISOString(),
    scopeLabel: parts.join(' · '),
    assets: inScope,
    records,
    counts: severityCounts(records),
    openCount: records.filter((r) => r.finding.status !== 'resolved').length,
    scope,
  };
}

/**
 * Report evidence frame: exposure correction, optional face redaction and an
 * audit stamp burned in by Cloudinary. Nothing generative.
 */
export function evidenceStillUrl(asset: MediaAsset, redact: boolean, width = 1200): string {
  const stamp = STEP_DEFINITIONS.text_stamp.build(
    { text: '{id} · {severity} · {date}', position: 'south_west', size: Math.max(18, Math.round(width / 50)) },
    { asset },
  );
  return deliveryUrl(
    refOf(asset),
    [
      ...stillBase(asset),
      component({ c: 'limit', w: width }),
      'e_improve',
      redact ? 'e_pixelate_faces:20' : '',
      stamp ?? '',
      'q_auto',
      'f_auto',
    ].filter(Boolean),
    asset.resourceType === 'video' ? 'jpg' : undefined,
  );
}

export function ageHours(iso: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 3_600_000));
}

/* ------------------------------------------------------------------------ */
/* Exports                                                                   */
/* ------------------------------------------------------------------------ */

export interface ReportPayload {
  schema: 'visualops.report/v1';
  kind: ReportKind;
  title: string;
  generatedAt: string;
  scope: string;
  summary: { findings: number; open: number; bySeverity: Record<Severity, number>; assets: number };
  findings: Array<{
    id: string;
    title: string;
    severity: Severity;
    category: string;
    status: FindingStatus;
    site: string;
    zone?: string;
    capturedAt: string;
    file: string;
    summary: string;
    action: string;
    evidence: string;
  }>;
  assets: Array<{
    id: string;
    file: string;
    type: string;
    site: string;
    cloudinary: { cloudName: string; publicId: string };
    original: { format: string; width: number; height: number; bytes?: number };
    delivered?: { bytes?: number; format?: string; cache?: string };
  }>;
}

export function reportPayload(model: ReportModel, measured: Record<string, DeliveryMetrics | undefined> = {}): ReportPayload {
  return {
    schema: 'visualops.report/v1',
    kind: model.kind,
    title: model.title,
    generatedAt: model.generatedAt,
    scope: model.scopeLabel,
    summary: {
      findings: model.records.length,
      open: model.openCount,
      bySeverity: model.counts,
      assets: model.assets.length,
    },
    findings: model.records.map(({ finding, asset }) => ({
      id: finding.id,
      title: finding.title,
      severity: finding.severity,
      category: CATEGORY_LABEL[finding.category],
      status: finding.status,
      site: asset.site,
      zone: asset.zone,
      capturedAt: asset.capturedAt,
      file: asset.fileName,
      summary: finding.summary,
      action: finding.action,
      evidence: evidenceStillUrl(asset, model.scope.redactFaces),
    })),
    assets: model.assets.map((a) => ({
      id: a.id,
      file: a.fileName,
      type: a.resourceType,
      site: a.site,
      cloudinary: { cloudName: a.cloudName, publicId: a.publicId },
      original: { format: a.format, width: a.width, height: a.height, bytes: a.bytes },
      delivered: measured[a.id]
        ? { bytes: measured[a.id]?.bytes, format: measured[a.id]?.format, cache: measured[a.id]?.cache }
        : undefined,
    })),
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const csvCell = (value: string | number | undefined) => {
  const s = value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(payload: ReportPayload): string {
  const header = ['id', 'title', 'severity', 'category', 'status', 'site', 'zone', 'captured_at', 'file', 'action', 'evidence_url'];
  const rows = payload.findings.map((f) =>
    [f.id, f.title, f.severity, f.category, f.status, f.site, f.zone ?? '', f.capturedAt, f.file, f.action, f.evidence]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

export function toMarkdown(payload: ReportPayload, fingerprint: string): string {
  const lines: string[] = [];
  lines.push(`# ${payload.title}`, '');
  lines.push(`Generated ${formatDateTime(payload.generatedAt)} · Scope: ${payload.scope}`, '');
  lines.push(
    `**${payload.summary.findings} findings** (${payload.summary.open} open) across ${payload.summary.assets} assets — ` +
      SEVERITIES.map((s) => `${s}: ${payload.summary.bySeverity[s]}`).join(' · '),
    '',
  );
  if (payload.findings.length) {
    lines.push('## Findings', '');
    lines.push('| ID | Severity | Status | Finding | Site | Captured |', '| --- | --- | --- | --- | --- | --- |');
    for (const f of payload.findings) {
      lines.push(
        `| ${f.id} | ${f.severity} | ${STATUS_LABEL[f.status]} | ${f.title.replace(/\|/g, '/')} | ${f.site}${f.zone ? ` · ${f.zone}` : ''} | ${isoDay(f.capturedAt)} |`,
      );
    }
    lines.push('');
    for (const f of payload.findings) {
      lines.push(`### ${f.id} — ${f.title}`, '');
      lines.push(`- **Severity:** ${f.severity} · **Category:** ${f.category} · **Status:** ${STATUS_LABEL[f.status]}`);
      lines.push(`- **Location:** ${f.site}${f.zone ? ` · ${f.zone}` : ''}`);
      lines.push(`- **Source file:** ${f.file}`);
      lines.push(`- **Observed:** ${f.summary}`);
      lines.push(`- **Action:** ${f.action}`);
      lines.push(`- **Evidence (Cloudinary, stamped):** ${f.evidence}`, '');
    }
  }
  if (payload.assets.some((a) => a.delivered)) {
    lines.push('## Delivery measured from Cloudinary', '');
    lines.push('| File | Original | Delivered | Cache |', '| --- | --- | --- | --- |');
    for (const a of payload.assets) {
      lines.push(
        `| ${a.file} | ${a.original.format.toUpperCase()} ${formatBytes(a.original.bytes)} | ${
          a.delivered ? `${(a.delivered.format ?? '').toUpperCase()} ${formatBytes(a.delivered.bytes)}` : '—'
        } | ${a.delivered?.cache ?? '—'} |`,
      );
    }
    lines.push('');
  }
  lines.push('---', '', `SHA-256 of the JSON payload: \`${fingerprint}\``, '');
  lines.push('Generated with VisualOps. Media delivered and transformed by Cloudinary.');
  return lines.join('\n');
}

export function downloadText(fileName: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
