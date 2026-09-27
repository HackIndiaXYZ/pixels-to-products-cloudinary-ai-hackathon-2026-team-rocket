import type { AssetSource, FindingStatus, MediaAsset, Severity } from '@/lib/types';
import {
  CATEGORY_LABEL,
  SEVERITIES,
  SEVERITY_RANK,
  STATUS_LABEL,
  captureBasisOf,
  fieldAssets,
  findingRecords,
  severityCounts,
  statusCounts,
  type FindingRecord,
} from '@/lib/analytics';
import { formatBytes, formatDateTime, isoDay, pluralize } from '@/lib/format';
import { refOf, stillBase } from '@/lib/cloudinary/media';
import { STEP_DEFINITIONS } from '@/lib/cloudinary/pipeline';
import { component, deliveryUrl } from '@/lib/cloudinary/url';
import type { DeliveryMetrics } from '@/lib/cloudinary/probe';

export type ReportKind = 'inspection' | 'incident' | 'media' | 'asset';

export const REPORT_KINDS: Array<{ kind: ReportKind; name: string; description: string }> = [
  { kind: 'inspection', name: 'Inspection report', description: 'Every finding in scope with stamped evidence and actions.' },
  { kind: 'incident', name: 'Incident summary', description: 'Unresolved issues (open and monitoring), worst first, with age.' },
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
  /** Findings in scope with status 'open' — the console's meaning of "open". */
  open: number;
  /** Findings in scope not yet resolved: open + monitoring. */
  unresolved: number;
  /**
   * @deprecated Ambiguous name kept for existing callers: this is the UNRESOLVED count
   * (open + monitoring), equal to `unresolved`. Use `unresolved`, or `open` for status 'open'.
   */
  openCount: number;
  /** Records whose finding text is a team-written sample annotation. */
  sampleRecords: number;
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
  parts.push(
    scope.assetIds ? pluralize(scope.assetIds.length, 'selected asset') : scope.sites.length ? scope.sites.join(', ') : 'All sites',
  );
  if (scope.windowDays !== null) parts.push(`last ${pluralize(scope.windowDays, 'day')}`);
  if (scope.minSeverity !== 'low') parts.push(`${scope.minSeverity} and above`);

  const status = statusCounts(records);
  const name = REPORT_KINDS.find((k) => k.kind === kind)!.name;
  return {
    kind,
    title: name,
    generatedAt: new Date(now).toISOString(),
    scopeLabel: parts.join(' · '),
    assets: inScope,
    records,
    counts: severityCounts(records),
    open: status.open,
    unresolved: status.unresolved,
    openCount: status.unresolved,
    sampleRecords: records.filter((r) => r.asset.source === 'sample').length,
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
/* Provenance                                                                */
/* ------------------------------------------------------------------------ */

/** Who wrote a finding's text, by where the record came from. */
export const ANNOTATION_AUTHOR: Record<AssetSource, string> = {
  sample: 'VisualOps team (sample annotation)',
  upload: 'Entered at ingest in VisualOps',
  sync: 'Cloudinary context metadata (synced)',
};

/**
 * How a record's capture time was obtained, as exported:
 * `sample-relative` — a bundled sample's time, set relative to the viewer's clock;
 * `recorded` — the time Cloudinary recorded, or the timestamp burned into the footage.
 */
export type CapturedAtBasis = 'sample-relative' | 'recorded';

export function capturedAtBasis(asset: MediaAsset): CapturedAtBasis {
  return captureBasisOf(asset) === 'sample-relative' ? 'sample-relative' : 'recorded';
}

/** The dataset note carried by exports that include sample records. */
export function sampleDatasetNote(assets: MediaAsset[]): string | undefined {
  const samples = assets.filter((a) => a.source === 'sample');
  if (!samples.length) return undefined;
  const parts = ['Sample annotations written by the VisualOps team', 'media on the Cloudinary demo cloud'];
  if (samples.some((a) => captureBasisOf(a) === 'sample-relative')) parts.push('sample capture times are relative to the viewer’s clock');
  if (samples.some((a) => captureBasisOf(a) === 'fixed')) parts.push('burned-in camera times are kept as shown in frame');
  return parts.join(' · ');
}

/* ------------------------------------------------------------------------ */
/* Exports                                                                   */
/* ------------------------------------------------------------------------ */

export interface ReportPayload {
  schema: 'visualops.report/v2';
  kind: ReportKind;
  title: string;
  generatedAt: string;
  scope: string;
  /** Present when any record in the report comes from the bundled sample dataset. */
  dataset?: {
    /** Records in this report that are sample annotations. */
    sampleRecords: number;
    note: string;
  };
  summary: {
    findings: number;
    /** Status 'open'. */
    open: number;
    monitoring: number;
    resolved: number;
    /** Not yet resolved: open + monitoring. */
    unresolved: number;
    bySeverity: Record<Severity, number>;
    assets: number;
  };
  findings: Array<{
    id: string;
    title: string;
    severity: Severity;
    category: string;
    status: FindingStatus;
    site: string;
    zone?: string;
    capturedAt: string;
    capturedAtBasis: CapturedAtBasis;
    /** Wall-clock time burned into the footage, verbatim (camera-local, no zone). */
    cameraTime?: string;
    file: string;
    summary: string;
    action: string;
    /** Who wrote the finding text. */
    annotation: { source: AssetSource; author: string };
    evidence: string;
  }>;
  assets: Array<{
    id: string;
    file: string;
    type: string;
    site: string;
    source: AssetSource;
    capturedAt: string;
    capturedAtBasis: CapturedAtBasis;
    cloudinary: { cloudName: string; publicId: string };
    original: { format: string; width: number; height: number; bytes?: number };
    delivered?: { bytes?: number; format?: string; cache?: string };
  }>;
}

export function reportPayload(model: ReportModel, measured: Record<string, DeliveryMetrics | undefined> = {}): ReportPayload {
  const status = statusCounts(model.records);
  const note = sampleDatasetNote([...model.assets, ...model.records.map((r) => r.asset)]);
  const sampleRecords = model.records.filter((r) => r.asset.source === 'sample').length;
  return {
    schema: 'visualops.report/v2',
    kind: model.kind,
    title: model.title,
    generatedAt: model.generatedAt,
    scope: model.scopeLabel,
    ...(note ? { dataset: { sampleRecords, note } } : {}),
    summary: {
      findings: model.records.length,
      open: status.open,
      monitoring: status.monitoring,
      resolved: status.resolved,
      unresolved: status.unresolved,
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
      capturedAtBasis: capturedAtBasis(asset),
      cameraTime: asset.cameraTime,
      file: asset.fileName,
      summary: finding.summary,
      action: finding.action,
      annotation: { source: asset.source, author: ANNOTATION_AUTHOR[asset.source] },
      evidence: evidenceStillUrl(asset, model.scope.redactFaces),
    })),
    assets: model.assets.map((a) => ({
      id: a.id,
      file: a.fileName,
      type: a.resourceType,
      site: a.site,
      source: a.source,
      capturedAt: a.capturedAt,
      capturedAtBasis: capturedAtBasis(a),
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
  let s = value === undefined ? '' : String(value);
  // A leading = + - @ would be run as a formula by spreadsheet apps.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(payload: ReportPayload): string {
  const header = [
    'id',
    'title',
    'severity',
    'category',
    'status',
    'site',
    'zone',
    'captured_at',
    'file',
    'action',
    'evidence_url',
    'annotation_source',
    'annotation_author',
    'captured_at_basis',
  ];
  const rows = payload.findings.map((f) =>
    [
      f.id,
      f.title,
      f.severity,
      f.category,
      f.status,
      f.site,
      f.zone ?? '',
      f.capturedAt,
      f.file,
      f.action,
      f.evidence,
      f.annotation.source,
      f.annotation.author,
      f.capturedAtBasis,
    ]
      .map(csvCell)
      .join(','),
  );
  return [header.join(','), ...rows].join('\n');
}

const cell = (s: string) => s.replace(/\|/g, '/').replace(/\s*\n\s*/g, ' ');

function capturedLine(f: ReportPayload['findings'][number]): string {
  if (f.cameraTime) return `${f.cameraTime} (camera time burned into the footage)`;
  const when = formatDateTime(f.capturedAt);
  if (f.capturedAtBasis === 'sample-relative') return `${when} (sample time, relative to the viewer’s clock)`;
  return f.annotation.source === 'sample' ? when : `${when} (time recorded by Cloudinary)`;
}

export function toMarkdown(payload: ReportPayload, fingerprint: string): string {
  const lines: string[] = [];
  lines.push(`# ${payload.title}`, '');
  if (payload.dataset) lines.push(`> **Sample dataset.** ${payload.dataset.note}.`, '');
  lines.push(`Generated ${formatDateTime(payload.generatedAt)} · Scope: ${payload.scope}`, '');
  const { summary } = payload;
  lines.push(
    `**${pluralize(summary.findings, 'finding')}** (${summary.open} open · ${summary.unresolved} unresolved) across ${pluralize(summary.assets, 'asset')} — ` +
      SEVERITIES.map((s) => `${s}: ${summary.bySeverity[s]}`).join(' · '),
    '',
  );
  if (payload.findings.length) {
    lines.push('## Findings', '');
    lines.push('| ID | Severity | Status | Finding | Site | Captured |', '| --- | --- | --- | --- | --- | --- |');
    for (const f of payload.findings) {
      const day = f.cameraTime ? f.cameraTime.slice(0, 10) : isoDay(f.capturedAt);
      lines.push(
        `| ${f.id} | ${f.severity} | ${STATUS_LABEL[f.status]} | ${cell(f.title)} | ${cell(f.site)}${f.zone ? ` · ${cell(f.zone)}` : ''} | ${day}${
          f.capturedAtBasis === 'sample-relative' ? ' (sample time)' : ''
        } |`,
      );
    }
    lines.push('');
    for (const f of payload.findings) {
      const sample = f.annotation.source === 'sample';
      lines.push(`### ${f.id} — ${f.title}`, '');
      lines.push(`- **Severity:** ${f.severity} · **Category:** ${f.category} · **Status:** ${STATUS_LABEL[f.status]}`);
      lines.push(`- **Location:** ${f.site}${f.zone ? ` · ${f.zone}` : ''}`);
      lines.push(`- **Captured:** ${capturedLine(f)}`);
      lines.push(`- **Source file:** ${f.file}`);
      lines.push(
        sample ? `- **Annotation (sample, team-written):** ${f.summary}` : `- **Observed** (${f.annotation.author}): ${f.summary}`,
      );
      lines.push(`- **Action:** ${f.action}`);
      lines.push(`- **Evidence (rendered by Cloudinary, stamped):** ${f.evidence}`, '');
    }
  }
  if (payload.assets.some((a) => a.delivered)) {
    lines.push('## Delivery measured from Cloudinary', '');
    lines.push('| File | Original | Delivered | Cache |', '| --- | --- | --- | --- |');
    for (const a of payload.assets) {
      lines.push(
        `| ${cell(a.file)} | ${a.original.format.toUpperCase()} ${formatBytes(a.original.bytes)} | ${
          a.delivered ? `${(a.delivered.format ?? '').toUpperCase()} ${formatBytes(a.delivered.bytes)}` : '—'
        } | ${a.delivered?.cache ?? '—'} |`,
      );
    }
    lines.push('');
  }
  lines.push('---', '', `SHA-256 of the JSON payload (provenance included): \`${fingerprint}\``, '');
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
