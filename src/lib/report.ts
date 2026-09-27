import type { AiUnderstanding, AssetSource, FindingStatus, MediaAsset, Region, ResourceType, Severity } from '@/lib/types';
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
import { DEMO_CLOUD } from '@/lib/cloudinary/config';
import { refOf, stillBase } from '@/lib/cloudinary/media';
import { STEP_DEFINITIONS } from '@/lib/cloudinary/pipeline';
import { component, deliveryUrl } from '@/lib/cloudinary/url';
import type { DeliveryMetrics } from '@/lib/cloudinary/probe';

export type ReportKind = 'inspection' | 'incident' | 'media' | 'asset';

export const REPORT_KINDS: Array<{ kind: ReportKind; name: string; description: string }> = [
  { kind: 'inspection', name: 'Inspection report', description: 'Every finding in scope with stamped evidence and actions.' },
  { kind: 'incident', name: 'Incident summary', description: 'Unresolved issues (open and monitoring), worst first, with age.' },
  { kind: 'media', name: 'Media analysis report', description: 'Formats, sizes, measured Cloudinary delivery and Cloudinary AI understanding.' },
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
    sampleRecords: records.filter((r) => isSampleAnnotation(r.asset)).length,
    scope,
  };
}

/** Width of the evidence rendition a report renders, requests from Cloudinary and exports — one URL for all three. */
export const REPORT_EVIDENCE_WIDTH = 800;

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

/**
 * Who wrote a record's human-classified fields, as exported:
 * `sample-annotation` — team-written for the sample workspace (bundled, or seeded into the team's cloud);
 * `ingest` — entered by a person when the media was uploaded in VisualOps;
 * `synced` — contextual metadata that was on the asset in Cloudinary (tagged outside VisualOps).
 */
export type AnnotationSource = 'sample-annotation' | 'ingest' | 'synced';

/**
 * A record is a sample annotation when it comes from the sample workspace: the bundled dataset, or a
 * record whose capture time is a sample time (`sample_hours_ago`, which only the sample seed writes).
 */
export function isSampleAnnotation(asset: MediaAsset): boolean {
  return asset.source === 'sample' || captureBasisOf(asset) === 'sample-relative';
}

export function annotationSource(asset: MediaAsset): AnnotationSource {
  if (isSampleAnnotation(asset)) return 'sample-annotation';
  return asset.source === 'upload' ? 'ingest' : 'synced';
}

/** Who wrote a finding's text, by where the record came from. */
export const ANNOTATION_AUTHOR: Record<AssetSource, string> = {
  sample: 'VisualOps team (sample annotation)',
  upload: 'Entered at ingest in VisualOps',
  sync: 'Cloudinary context metadata (synced)',
};

const AUTHOR_BY_SOURCE: Record<AnnotationSource, string> = {
  'sample-annotation': ANNOTATION_AUTHOR.sample,
  ingest: ANNOTATION_AUTHOR.upload,
  synced: ANNOTATION_AUTHOR.sync,
};

export function annotationAuthor(asset: MediaAsset): string {
  return AUTHOR_BY_SOURCE[annotationSource(asset)];
}

/**
 * How a record's capture time was obtained, as exported:
 * `sample-relative` — a sample time, set relative to the viewer's clock;
 * `recorded` — the time Cloudinary recorded, or the timestamp burned into the footage.
 */
export type CapturedAtBasis = 'sample-relative' | 'recorded';

export function capturedAtBasis(asset: MediaAsset): CapturedAtBasis {
  return captureBasisOf(asset) === 'sample-relative' ? 'sample-relative' : 'recorded';
}

/** The dataset note carried by exports that include sample records. */
export function sampleDatasetNote(assets: MediaAsset[]): string | undefined {
  const samples = assets.filter(isSampleAnnotation);
  if (!samples.length) return undefined;
  const parts = ['Sample annotations written by the VisualOps team'];
  const demo = samples.filter((a) => a.cloudName === DEMO_CLOUD).length;
  if (demo) parts.push('media on the Cloudinary demo cloud');
  if (demo < samples.length) parts.push('media in the team’s Cloudinary cloud');
  if (samples.some((a) => captureBasisOf(a) === 'sample-relative')) parts.push('sample capture times are relative to the viewer’s clock');
  if (samples.some((a) => captureBasisOf(a) === 'fixed')) parts.push('burned-in camera times are kept as shown in frame');
  return parts.join(' · ');
}

/* ------------------------------------------------------------------------ */
/* Export payload                                                            */
/* ------------------------------------------------------------------------ */

export const PAYLOAD_SCHEMA = 'visualops.report/v3';

/** What each provenance class means, carried in every payload so the export explains itself. */
export const PROVENANCE_LEGEND = {
  human: 'Human classified — written by a person: entered at ingest in VisualOps, or a sample annotation written by the VisualOps team',
  ai: 'AI detected — returned by Cloudinary AI: AI Content Analysis captioning, object detection and auto-tagging; face detection (fl_getinfo)',
  system: 'System derived — computed or measured by VisualOps from the records and Cloudinary’s responses during this run',
} as const;

/** What the SHA-256 shown with a report covers — the same words on screen, in the payload and in the Markdown export. */
export const HASH_COVERS =
  'the exported JSON: records + evidence URLs + delivery results — every record’s human-classified fields with their provenance, ' +
  'the Cloudinary AI understanding, the evidence frame URL exactly as rendered, its delivery result from this run (HTTP status, bytes, ' +
  'format), the Cloudinary face-detection count and the capture-time basis. The image bytes themselves are not hashed; each frame’s URL ' +
  'and measured size are';

export const hashVerifyCommand = (fileName: string): string => `sha256sum ${fileName}`;

/** Cloudinary AI understanding of an asset, as exported. Always machine-generated. */
export interface PayloadAi {
  provenance: 'ai';
  engine: 'Cloudinary AI Content Analysis';
  caption?: string;
  objects: Array<{ label: string; confidence: number; box?: Region }>;
  /** Tags Cloudinary's auto-tagging added to the asset. */
  tags: string[];
  model?: string;
  analyzedAt?: string;
}

/** The result of this run's request for exactly the evidence URL. */
export interface PayloadDelivery {
  provenance: 'system';
  /** 'delivered': Cloudinary answered HTTP 2xx for exactly this URL during the run. Nothing more is checked. */
  result: 'delivered' | 'not-delivered';
  httpStatus?: number;
  bytes?: number;
  format?: string;
  width?: number;
  height?: number;
  cache?: 'hit' | 'miss';
  roundTripMs?: number;
  /** Why the frame was not delivered. */
  reason?: string;
}

/** Cloudinary's automatic face detections on the frame — the detector e_pixelate_faces uses. */
export interface PayloadFaces {
  provenance: 'ai';
  detector: 'Cloudinary face detection (fl_getinfo)';
  /** Faces Cloudinary detected; null when the detections could not be read during the run. */
  detected: number | null;
  /** Whether the frame is rendered with e_pixelate_faces. */
  pixelated: boolean;
}

export interface PayloadEvidence {
  /** The evidence frame URL, exactly as the report renders it. */
  url: string;
  /** Pipeline integrity class of the rendition: correction, redaction and a stamp — nothing generated. */
  integrity: 'evidence';
  /** Null when the frame was not requested (e.g. the fixed sample payload on the landing page). */
  delivery: PayloadDelivery | null;
  /** Null when Cloudinary's face detections were not requested. */
  faces: PayloadFaces | null;
}

export interface PayloadFinding {
  id: string;
  file: string;
  media: { type: ResourceType; cloudName: string; publicId: string; width: number; height: number; frameAtSeconds?: number };
  capture: {
    capturedAt: string;
    basis: CapturedAtBasis;
    /** Wall-clock time burned into the footage, verbatim (camera-local, no zone). */
    cameraTime?: string;
    capturedBy: string;
  };
  /** The record's human-classified fields and who wrote them. */
  classification: {
    provenance: 'human';
    source: AnnotationSource;
    author: string;
    title: string;
    site: string;
    zone?: string;
    category: string;
    severity: Severity;
    status: FindingStatus;
    summary: string;
    action: string;
    /** Marked region, percent of the frame. */
    region?: Region;
  };
  /** Cloudinary AI understanding, when the asset has been analysed. */
  ai: PayloadAi | null;
  evidence: PayloadEvidence;
}

export interface PayloadAsset {
  id: string;
  file: string;
  type: ResourceType;
  site: string;
  source: AnnotationSource;
  capture: { capturedAt: string; basis: CapturedAtBasis; cameraTime?: string };
  cloudinary: { cloudName: string; publicId: string };
  original: { format: string; width: number; height: number; bytes?: number };
  /** Media analysis only: the rendition the console serves, measured during this run. */
  delivered?: { provenance: 'system'; bytes?: number; format?: string; cache?: string };
  /** Media analysis only: Cloudinary face detections on the asset (null when they could not be read). */
  faces?: { provenance: 'ai'; detected: number | null };
  ai: PayloadAi | null;
}

export interface ReportPayload {
  schema: typeof PAYLOAD_SCHEMA;
  kind: ReportKind;
  title: string;
  generatedAt: string;
  scope: string;
  /** What each provenance class in this payload means. */
  provenance: typeof PROVENANCE_LEGEND;
  /** What the report's SHA-256 covers and how to recompute it. */
  integrity: { algorithm: 'SHA-256'; covers: string; verify: string };
  /** Present when any record in the report comes from the sample workspace. */
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
    /** Records in this report with a Cloudinary AI understanding. */
    aiAnalysed: number;
    evidence: { frames: number; delivered: number; notDelivered: number; notRequested: number };
  };
  findings: PayloadFinding[];
  assets: PayloadAsset[];
}

/** What a report run learned about one evidence frame (see the report job's attach stage). */
export interface EvidenceResult {
  /** The URL rendered and requested. */
  url: string;
  /** Undefined when the frame was not requested. */
  delivery?: {
    delivered: boolean;
    httpStatus?: number;
    metrics?: DeliveryMetrics;
    reason?: string;
  };
  /** Faces Cloudinary detected; null when fl_getinfo failed; undefined when not requested. */
  faces?: number | null;
}

export interface PayloadOptions {
  /** Media analysis: delivery measured for the served rendition, by asset id. */
  measured?: Record<string, DeliveryMetrics | undefined>;
  /** Media analysis: Cloudinary face detections by asset id (null when fl_getinfo failed). */
  faces?: Record<string, number | null | undefined>;
  /** Evidence frames by finding id: the URL rendered and what the run measured for it. */
  evidence?: Record<string, EvidenceResult | undefined>;
  /** File name used in the verification command (default `<kind>.json`). */
  fileName?: string;
}

export function payloadAi(ai: AiUnderstanding | undefined): PayloadAi | null {
  if (!ai) return null;
  return {
    provenance: 'ai',
    engine: 'Cloudinary AI Content Analysis',
    caption: ai.caption,
    objects: ai.objects.map((o) => ({ label: o.label, confidence: o.confidence, box: o.box })),
    tags: ai.tags,
    model: ai.model,
    analyzedAt: ai.analyzedAt,
  };
}

function payloadDelivery(result: EvidenceResult['delivery']): PayloadDelivery | null {
  if (!result) return null;
  const m = result.metrics;
  return {
    provenance: 'system',
    result: result.delivered ? 'delivered' : 'not-delivered',
    httpStatus: result.httpStatus,
    bytes: m?.bytes,
    format: m?.format,
    width: m?.width,
    height: m?.height,
    cache: m?.cache,
    roundTripMs: m ? Math.round(m.elapsedMs) : undefined,
    reason: result.reason,
  };
}

export function reportPayload(model: ReportModel, options: PayloadOptions = {}): ReportPayload {
  const { measured = {}, faces = {}, evidence = {} } = options;
  const status = statusCounts(model.records);
  const note = sampleDatasetNote([...model.assets, ...model.records.map((r) => r.asset)]);
  const redact = model.scope.redactFaces;

  const findings: PayloadFinding[] = model.records.map(({ finding, asset }): PayloadFinding => {
    const frame = evidence[finding.id];
    const url = frame?.url ?? evidenceStillUrl(asset, redact, REPORT_EVIDENCE_WIDTH);
    const detected = frame?.faces;
    return {
      id: finding.id,
      file: asset.fileName,
      media: {
        type: asset.resourceType,
        cloudName: asset.cloudName,
        publicId: asset.publicId,
        width: asset.width,
        height: asset.height,
        frameAtSeconds: asset.resourceType === 'video' ? (asset.posterOffset ?? 1) : undefined,
      },
      capture: {
        capturedAt: asset.capturedAt,
        basis: capturedAtBasis(asset),
        cameraTime: asset.cameraTime,
        capturedBy: asset.capturedBy,
      },
      classification: {
        provenance: 'human',
        source: annotationSource(asset),
        author: annotationAuthor(asset),
        title: finding.title,
        site: asset.site,
        zone: asset.zone,
        category: CATEGORY_LABEL[finding.category],
        severity: finding.severity,
        status: finding.status,
        summary: finding.summary,
        action: finding.action,
        region: finding.region,
      },
      ai: payloadAi(asset.ai),
      evidence: {
        url,
        integrity: 'evidence',
        delivery: payloadDelivery(frame?.delivery),
        faces:
          detected === undefined
            ? null
            : { provenance: 'ai', detector: 'Cloudinary face detection (fl_getinfo)', detected, pixelated: redact },
      },
    };
  });

  const delivered = findings.filter((f) => f.evidence.delivery?.result === 'delivered').length;
  const notRequested = findings.filter((f) => !f.evidence.delivery).length;
  const fileName = options.fileName ?? `${model.kind}.json`;

  return {
    schema: PAYLOAD_SCHEMA,
    kind: model.kind,
    title: model.title,
    generatedAt: model.generatedAt,
    scope: model.scopeLabel,
    provenance: PROVENANCE_LEGEND,
    integrity: { algorithm: 'SHA-256', covers: `SHA-256 of ${HASH_COVERS}.`, verify: hashVerifyCommand(fileName) },
    ...(note ? { dataset: { sampleRecords: model.records.filter((r) => isSampleAnnotation(r.asset)).length, note } } : {}),
    summary: {
      findings: model.records.length,
      open: status.open,
      monitoring: status.monitoring,
      resolved: status.resolved,
      unresolved: status.unresolved,
      bySeverity: model.counts,
      assets: model.assets.length,
      aiAnalysed: model.records.filter((r) => r.asset.ai).length,
      evidence: {
        frames: findings.length,
        delivered,
        notDelivered: findings.length - delivered - notRequested,
        notRequested,
      },
    },
    findings,
    assets: model.assets.map((a): PayloadAsset => {
      const m = measured[a.id];
      const detected = faces[a.id];
      return {
        id: a.id,
        file: a.fileName,
        type: a.resourceType,
        site: a.site,
        source: annotationSource(a),
        capture: { capturedAt: a.capturedAt, basis: capturedAtBasis(a), cameraTime: a.cameraTime },
        cloudinary: { cloudName: a.cloudName, publicId: a.publicId },
        original: { format: a.format, width: a.width, height: a.height, bytes: a.bytes },
        delivered: m ? { provenance: 'system', bytes: m.bytes, format: m.format, cache: m.cache } : undefined,
        faces: detected === undefined ? undefined : { provenance: 'ai', detected },
        ai: payloadAi(a.ai),
      };
    }),
  };
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ------------------------------------------------------------------------ */
/* Text exports                                                              */
/* ------------------------------------------------------------------------ */

/** Control characters and bidirectional overrides, which can make exported text read differently from what it holds. */
function isUnsafeChar(code: number): boolean {
  return code < 0x20 || code === 0x7f || (code >= 0x202a && code <= 0x202e) || (code >= 0x2066 && code <= 0x2069);
}

/** Collapses line breaks and drops control / bidi-override characters. */
function plain(value: string): string {
  return Array.from(value.replace(/\s*[\r\n\t]+\s*/g, ' '))
    .filter((ch) => !isUnsafeChar(ch.codePointAt(0) ?? 0))
    .join('');
}

const pct = (confidence: number) => `${Math.round(confidence * 100)}%`;

/** "truck 77% · person 61%" — Cloudinary's detected objects with confidence. */
export function aiObjectsText(ai: Pick<PayloadAi, 'objects'>, limit = 8): string {
  const shown = ai.objects.slice(0, limit).map((o) => `${o.label} ${pct(o.confidence)}`);
  const more = ai.objects.length - shown.length;
  return [...shown, ...(more > 0 ? [`+${more} more`] : [])].join(' · ');
}

const csvCell = (value: string | number | null | undefined) => {
  let s = value === undefined || value === null ? '' : String(value);
  // A leading = + - @ (or a tab / carriage return) would be run as a formula by spreadsheet apps.
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
    'summary',
    'action',
    'annotation_provenance',
    'annotation_source',
    'annotation_author',
    'captured_at',
    'captured_at_basis',
    'camera_time',
    'file',
    'ai_provenance',
    'ai_caption',
    'ai_objects',
    'ai_tags',
    'ai_model',
    'ai_analyzed_at',
    'evidence_url',
    'evidence_delivery',
    'evidence_http_status',
    'evidence_bytes',
    'evidence_format',
    'faces_detected',
    'faces_pixelated',
  ];
  const rows = payload.findings.map((f) => {
    const c = f.classification;
    const d = f.evidence.delivery;
    return [
      f.id,
      c.title,
      c.severity,
      c.category,
      c.status,
      c.site,
      c.zone,
      c.summary,
      c.action,
      c.provenance,
      c.source,
      c.author,
      f.capture.capturedAt,
      f.capture.basis,
      f.capture.cameraTime,
      f.file,
      f.ai ? f.ai.provenance : '',
      f.ai?.caption,
      f.ai ? aiObjectsText(f.ai, 20) : '',
      f.ai?.tags.join(', '),
      f.ai?.model,
      f.ai?.analyzedAt,
      f.evidence.url,
      d ? d.result : 'not-requested',
      d?.httpStatus,
      d?.bytes,
      d?.format,
      f.evidence.faces ? (f.evidence.faces.detected ?? 'unavailable') : '',
      f.evidence.faces ? String(f.evidence.faces.pixelated) : '',
    ]
      .map((v) => csvCell(typeof v === 'string' ? plain(v) : v))
      .join(',');
  });
  return [header.join(','), ...rows].join('\n');
}

/**
 * Escapes text that came from a record or from Cloudinary for Markdown, so it renders as the literal text:
 * no emphasis, links, images, HTML, entities, code, headings or table breaks can be injected, and bare
 * URLs / e-mail addresses are not turned into links. Line breaks are collapsed.
 */
export function mdText(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  return plain(String(value))
    .replace(/[\\`*_{}[\]()#+!|<>~&@]/g, '\\$&')
    .replace(/:(?=\/\/)/g, '\\:')
    .replace(/\b(www)\./gi, '$1\\.');
}

/** A generated Cloudinary URL as a Markdown autolink; anything unexpected is shown as escaped text instead. */
function mdUrl(url: string): string {
  return /^https:\/\/[^\s<>`\\"']+$/.test(url) ? `<${url}>` : mdText(url);
}

function capturedLine(f: PayloadFinding): string {
  if (f.capture.cameraTime) return `${mdText(f.capture.cameraTime)} (camera time burned into the footage)`;
  const when = formatDateTime(f.capture.capturedAt);
  if (f.capture.basis === 'sample-relative') return `${when} (sample time, relative to the viewer’s clock)`;
  return f.classification.source === 'sample-annotation' ? when : `${when} (time recorded by Cloudinary)`;
}

function deliveryLine(d: PayloadDelivery | null): string {
  if (!d) return 'not requested';
  if (d.result === 'delivered') {
    return [
      `HTTP ${d.httpStatus ?? 200}`,
      `${(d.format ?? '').toUpperCase()} ${formatBytes(d.bytes)}`.trim(),
      d.width && d.height ? `${d.width}×${d.height}` : '',
      d.cache ? `CDN ${d.cache}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return ['not delivered', d.httpStatus ? `HTTP ${d.httpStatus}` : '', d.reason ? mdText(d.reason) : ''].filter(Boolean).join(' · ');
}

function facesLine(faces: PayloadFaces | null): string {
  if (!faces) return 'not requested';
  if (faces.detected === null) return `unavailable (fl_getinfo failed)${faces.pixelated ? ' · e_pixelate_faces applied' : ''}`;
  if (!faces.pixelated) return `${pluralize(faces.detected, 'face')} detected · no redaction`;
  return faces.detected ? `${pluralize(faces.detected, 'face')} detected · pixelated (e_pixelate_faces)` : 'none detected · nothing pixelated';
}

export function toMarkdown(payload: ReportPayload, fingerprint: string, jsonFileName = payload.integrity.verify.replace(/^sha256sum /, '')): string {
  const lines: string[] = [];
  lines.push(`# ${mdText(payload.title)}`, '');
  if (payload.dataset) lines.push(`> **Sample dataset.** ${mdText(payload.dataset.note)}.`, '');
  lines.push(`Generated ${formatDateTime(payload.generatedAt)} · Scope: ${mdText(payload.scope)}`, '');
  lines.push(
    '**Provenance.** *Human classified*: written by a person (entered at ingest, or a team-written sample annotation) · ' +
      '*AI detected*: returned by Cloudinary AI (captioning, object detection, auto-tagging, face detection) · ' +
      '*System derived*: computed or measured by VisualOps during this run.',
    '',
  );
  const { summary } = payload;
  lines.push(
    `**${pluralize(summary.findings, 'finding')}** (${summary.open} open · ${summary.unresolved} unresolved) across ${pluralize(summary.assets, 'asset')} — ` +
      SEVERITIES.map((s) => `${s}: ${summary.bySeverity[s]}`).join(' · '),
    '',
  );
  if (summary.findings) {
    lines.push(
      `Cloudinary AI understanding on ${summary.aiAnalysed} of ${pluralize(summary.findings, 'record')} · evidence frames delivered: ${summary.evidence.delivered}/${summary.evidence.frames}`,
      '',
    );
  }

  if (payload.findings.length) {
    lines.push('## Findings', '');
    lines.push('| ID | Severity | Status | Finding | Site | Captured | AI detected |', '| --- | --- | --- | --- | --- | --- | --- |');
    for (const f of payload.findings) {
      const c = f.classification;
      const day = f.capture.cameraTime ? mdText(f.capture.cameraTime.slice(0, 10)) : isoDay(f.capture.capturedAt);
      const ai = f.ai ? mdText(f.ai.objects.slice(0, 3).map((o) => o.label).join(', ') || f.ai.caption || 'analysed') : '—';
      lines.push(
        `| ${mdText(f.id)} | ${c.severity} | ${STATUS_LABEL[c.status]} | ${mdText(c.title)} | ${mdText(c.site)}${c.zone ? ` · ${mdText(c.zone)}` : ''} | ${day}${
          f.capture.basis === 'sample-relative' ? ' (sample time)' : ''
        } | ${ai} |`,
      );
    }
    lines.push('');
    for (const f of payload.findings) {
      const c = f.classification;
      lines.push(`### ${mdText(f.id)} — ${mdText(c.title)}`, '');
      lines.push(
        c.source === 'sample-annotation'
          ? '**Human classified** · sample annotation, written by the VisualOps team'
          : `**Human classified** · ${mdText(c.author)}`,
        '',
      );
      lines.push(`- **Severity:** ${c.severity} · **Category:** ${mdText(c.category)} · **Status:** ${STATUS_LABEL[c.status]}`);
      lines.push(`- **Location:** ${mdText(c.site)}${c.zone ? ` · ${mdText(c.zone)}` : ''}`);
      lines.push(`- **Observation:** ${mdText(c.summary)}`);
      lines.push(`- **Action:** ${mdText(c.action)}`, '');
      if (f.ai) {
        const meta = [f.ai.model ? mdText(f.ai.model) : '', f.ai.analyzedAt ? `analysed ${formatDateTime(f.ai.analyzedAt)}` : ''].filter(Boolean);
        lines.push(`**AI detected** · Cloudinary AI Content Analysis${meta.length ? ` · ${meta.join(' · ')}` : ''}`, '');
        if (f.ai.caption) lines.push(`- **Caption:** ${mdText(f.ai.caption)}`);
        lines.push(`- **Objects:** ${f.ai.objects.length ? mdText(aiObjectsText(f.ai)) : 'none above the confidence threshold'}`);
        if (f.ai.tags.length) lines.push(`- **Auto-tags:** ${mdText(f.ai.tags.join(', '))}`);
        lines.push('');
      } else {
        lines.push(
          `**AI detected** · ${f.media.type === 'video' ? 'not analysed (Cloudinary AI analysis runs on images)' : 'not analysed by Cloudinary AI'}`,
          '',
        );
      }
      lines.push(`- **Captured:** ${capturedLine(f)}`);
      lines.push(`- **Source file:** ${mdText(f.file)}`);
      lines.push(`- **Evidence frame** (rendered by Cloudinary, stamped, no generative edits): ${mdUrl(f.evidence.url)}`);
      lines.push(`  - **Delivery** (system derived, this run): ${deliveryLine(f.evidence.delivery)}`);
      lines.push(`  - **Faces** (AI detected, Cloudinary): ${facesLine(f.evidence.faces)}`, '');
    }
  }

  if (payload.kind === 'media' || payload.kind === 'asset' || payload.assets.some((a) => a.delivered)) {
    lines.push('## Media', '');
    lines.push('| File | Original | Delivered (measured) | Cache | AI detected (Cloudinary) |', '| --- | --- | --- | --- | --- |');
    for (const a of payload.assets) {
      lines.push(
        `| ${mdText(a.file)} | ${mdText(a.original.format.toUpperCase())} ${formatBytes(a.original.bytes)} | ${
          a.delivered ? `${mdText((a.delivered.format ?? '').toUpperCase())} ${formatBytes(a.delivered.bytes)}` : '—'
        } | ${a.delivered?.cache ?? '—'} | ${a.ai ? mdText(aiObjectsText(a.ai, 4) || a.ai.caption || 'analysed') : '—'} |`,
      );
    }
    lines.push('');
  }

  lines.push('---', '');
  lines.push(`**SHA-256 of the JSON export:** \`${fingerprint.replace(/[^0-9a-f]/gi, '')}\``, '');
  lines.push(`Covers ${HASH_COVERS}.`, '');
  lines.push(
    `This Markdown file is a rendering of that JSON and is not itself hashed. Recompute with \`${hashVerifyCommand(
      jsonFileName.replace(/[`\s]/g, ''),
    )}\`.`,
    '',
  );
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
