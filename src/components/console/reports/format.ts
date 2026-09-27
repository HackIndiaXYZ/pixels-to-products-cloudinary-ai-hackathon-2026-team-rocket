import { capturedAtBasis, type ReportKind } from '@/lib/report';
import type { MediaAsset, Region } from '@/lib/types';
import { formatDateTime, isoDay } from '@/lib/format';
import type { EvidenceProbe } from './job';

/** Work time with enough precision to be honest about sub-millisecond stages. */
export function formatWork(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1) return `${ms.toFixed(2)} ms`;
  if (ms < 10) return `${ms.toFixed(1)} ms`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Content-derived document identifier: the first 32 bits of the package hash. */
export const documentId = (hash: string): string => `VO-RPT-${hash.slice(0, 8).toUpperCase()}`;

/** SHA-256 hex split into 8-character groups for reading aloud and comparing. */
export const groupHash = (hash: string): string => (hash.match(/.{1,8}/g) ?? [hash]).join(' ');

export const exportBase = (kind: ReportKind, generatedAt: string): string => `visualops-${kind}-${isoDay(generatedAt)}`;

/** Where a finding's text came from. The bundled dataset's findings are team-written sample annotations. */
export function provenance(asset: MediaAsset): string {
  if (asset.source === 'upload') return 'Entered at ingest';
  if (asset.source === 'sync') return 'Synced record';
  return 'Sample annotation';
}

export const SECTION_TITLE: Record<ReportKind, string> = {
  inspection: 'Findings',
  incident: 'Incident register',
  media: 'Media and delivery',
  asset: 'Asset inventory',
};

/* ------------------------------------------------------------------------ */
/* Capture times                                                             */
/* ------------------------------------------------------------------------ */

export interface CaptureText {
  /** The time as shown: the camera's burned-in time verbatim, otherwise the capture instant in local time. */
  when: string;
  /** How the time was obtained, in the Markdown export's words; absent for plain sample times with no basis to state. */
  basis?: string;
  /** A two-word form of `basis` for table cells. */
  short?: string;
}

/**
 * A capture time as the report shows it, qualified the same way the Markdown export qualifies it, so a
 * sample time is never read as real capture metadata.
 */
export function captureText(asset: MediaAsset): CaptureText {
  if (asset.cameraTime) return { when: asset.cameraTime, basis: 'camera time burned into the footage', short: 'camera time' };
  const when = formatDateTime(asset.capturedAt);
  if (capturedAtBasis(asset) === 'sample-relative') {
    return { when, basis: 'sample time, relative to the viewer’s clock', short: 'sample time' };
  }
  return asset.source === 'sample' ? { when } : { when, basis: 'time recorded by Cloudinary', short: 'recorded' };
}

/* ------------------------------------------------------------------------ */
/* Face redaction: what e_pixelate_faces actually did to a frame             */
/* ------------------------------------------------------------------------ */

const PEOPLE_TAGS = new Set(['people', 'person', 'crew', 'worker', 'workers']);

/** The record says people are in frame (tagged at capture). */
export const peopleRecorded = (asset: MediaAsset): boolean => asset.tags.some((t) => PEOPLE_TAGS.has(t.toLowerCase()));

const overlaps = (a: Region, b: Region): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export interface FrameRedaction {
  /** Cloudinary's face detections on the frame; undefined when fl_getinfo gave no answer. */
  faces?: Region[];
  /** Notes a reviewer must act on before sharing the frame (empty when there is nothing to check). */
  checks: string[];
}

/**
 * What face redaction did to one evidence frame, from Cloudinary's own detections (fl_getinfo — the detector
 * e_pixelate_faces uses). Checks are raised only when redaction is on: people recorded but not detected (so
 * not hidden), or a pixelated face box overlapping the finding's marked region (so evidence may be hidden).
 */
export function frameRedaction(asset: MediaAsset, probe: EvidenceProbe | undefined, redact: boolean): FrameRedaction {
  const faces = Array.isArray(probe?.faces) ? probe.faces : undefined;
  const checks: string[] = [];
  if (redact && faces) {
    if (faces.length === 0 && peopleRecorded(asset)) checks.push('People recorded in frame were not detected — not redacted');
    const region = asset.finding?.region;
    if (region && faces.some((f) => overlaps(f, region))) {
      checks.push('A pixelated region overlaps the marked finding area — check the original');
    }
  }
  return { faces, checks };
}

/** Per-figure redaction line, worded from Cloudinary's result for this frame. */
export function redactionCaption(redaction: FrameRedaction, redact: boolean): string {
  const { faces } = redaction;
  if (!redact) {
    return faces?.length
      ? `No face redaction · Cloudinary detected ${faces.length} possible ${faces.length === 1 ? 'face' : 'faces'}`
      : 'No face redaction';
  }
  if (!faces) return 'e_pixelate_faces · Cloudinary face detections unavailable (fl_getinfo failed)';
  if (!faces.length) return 'e_pixelate_faces · Cloudinary detected no faces — nothing pixelated';
  return `e_pixelate_faces · ${faces.length} ${faces.length === 1 ? 'region' : 'regions'} pixelated (Cloudinary detections)`;
}
