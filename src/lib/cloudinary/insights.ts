import type { MediaAsset, Region } from '@/lib/types';
import { insightUrl } from './media';
import { pushActivity } from './probe';

/**
 * Live AI signals from Cloudinary's `fl_getinfo` flag.
 *
 * `insightUrl` asks Cloudinary for a 1:1 `g_auto` crop with `fl_getinfo`, and
 * the JSON it returns carries two things computed by Cloudinary's own models:
 *
 * - `g_auto_info`: the crop window g_auto chose. Its size is fixed by the
 *   requested 1:1 aspect ratio (on a landscape frame it is always full height),
 *   so only its position is a content signal — where Cloudinary placed the
 *   crop. It is not a detected subject box and must not be labelled as one.
 * - `landmarks`: facial landmarks from Cloudinary's automatic face detection.
 *   Detections can be false positives (and can miss people), so present them
 *   as detections, not as ground truth.
 *
 * VisualOps converts both into percentage rectangles over the original frame.
 */

export interface CloudinaryInsight {
  url: string;
  inputWidth: number;
  inputHeight: number;
  inputBytes: number;
  /**
   * The crop window Cloudinary's g_auto chose (`g_auto_info`) for the requested
   * aspect ratio — 1:1 for `insightUrl` — in percent of the frame, labelled
   * `'g_auto crop'`. Crop geometry, not a subject box: its size follows the
   * requested aspect ratio; only its position reflects the content (see
   * `cropCentre`). The field keeps the name `focus` for compatibility.
   */
  focus?: Region;
  /** Approximate boxes around Cloudinary's automatic face detections, derived from their landmarks. */
  faces: Region[];
}

/** Label carried by `CloudinaryInsight.focus`. */
export const CROP_LABEL = 'g_auto crop';

interface Point {
  x: number;
  y: number;
}

interface GetInfoResponse {
  input?: { width: number; height: number; bytes: number };
  g_auto_info?: Array<{ x: number; y: number; width: number; height: number }>;
  landmarks?: Array<Array<Record<string, Point>>>;
}

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

function faceBox(landmarks: Record<string, Point>, width: number, height: number): Region | null {
  const pts = Object.values(landmarks).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const size = Math.max(span * 2.4, 12);
  const x = ((cx - size / 2) / width) * 100;
  const y = ((cy - size * 0.58) / height) * 100;
  return {
    x: clampPct(x),
    y: clampPct(y),
    w: clampPct((size / width) * 100),
    h: clampPct((size / height) * 100),
    label: 'FACE',
  };
}

export function parseInsight(url: string, data: GetInfoResponse): CloudinaryInsight {
  const width = data.input?.width ?? 1;
  const height = data.input?.height ?? 1;
  const g = data.g_auto_info?.[0];
  const faces = (data.landmarks?.[0] ?? [])
    .map((l) => faceBox(l, width, height))
    .filter((f): f is Region => f !== null);
  return {
    url,
    inputWidth: width,
    inputHeight: height,
    inputBytes: data.input?.bytes ?? 0,
    focus: g
      ? {
          x: clampPct((g.x / width) * 100),
          y: clampPct((g.y / height) * 100),
          w: clampPct((g.width / width) * 100),
          h: clampPct((g.height / height) * 100),
          label: CROP_LABEL,
        }
      : undefined,
    faces,
  };
}

/**
 * Where g_auto placed its crop: the crop centre along the axis it could move
 * on — across when the window spans (nearly) the full height, as a 1:1 crop of
 * a landscape frame does; down when it spans the full width. Percent of the
 * frame, rounded. Works for any requested aspect ratio.
 */
export function cropCentre(focus: Region): { axis: 'x' | 'y'; pct: number } {
  return focus.w <= focus.h
    ? { axis: 'x', pct: Math.round(focus.x + focus.w / 2) }
    : { axis: 'y', pct: Math.round(focus.y + focus.h / 2) };
}

/** e.g. "centred at 41% across" (landscape) or "centred at 30% down" (portrait). */
export function describeCropCentre(focus: Region): string {
  const { axis, pct } = cropCentre(focus);
  return `centred at ${pct}% ${axis === 'x' ? 'across' : 'down'}`;
}

/** "N face detection(s)" — Cloudinary's automatic detections, which can include false positives. */
export function faceDetections(count: number): string {
  return `${count} face detection${count === 1 ? '' : 's'}`;
}

const cache = new Map<string, Promise<CloudinaryInsight>>();
const settled = new Map<string, CloudinaryInsight>();

/** True when this session already holds Cloudinary's fl_getinfo answer for the asset: `fetchInsight` will not send a request. */
export function insightCached(asset: MediaAsset): boolean {
  return settled.has(insightUrl(asset));
}

/** The settled fl_getinfo result for the asset, if this session already has it (lets a view render without waiting a tick). */
export function cachedInsight(asset: MediaAsset): CloudinaryInsight | undefined {
  return settled.get(insightUrl(asset));
}

export function fetchInsight(asset: MediaAsset): Promise<CloudinaryInsight> {
  const url = insightUrl(asset);
  const cached = cache.get(url);
  if (cached) return cached;
  const promise = fetch(url)
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(res.headers.get('x-cld-error') ?? `fl_getinfo returned HTTP ${res.status}`);
      }
      const insight = parseInsight(url, (await res.json()) as GetInfoResponse);
      settled.set(url, insight);
      pushActivity(
        'insight',
        url,
        `fl_getinfo · ${faceDetections(insight.faces.length)} · ${
          insight.focus ? `g_auto 1:1 crop ${describeCropCentre(insight.focus)}` : 'no g_auto crop reported'
        }`,
      );
      return insight;
    })
    .catch((error: unknown) => {
      cache.delete(url);
      throw error;
    });
  cache.set(url, promise);
  return promise;
}
