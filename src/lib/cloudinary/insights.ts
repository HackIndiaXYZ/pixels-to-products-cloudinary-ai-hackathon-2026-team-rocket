import type { MediaAsset, Region } from '@/lib/types';
import { insightUrl } from './media';

/**
 * Live AI signals from Cloudinary's `fl_getinfo` flag.
 *
 * The response is produced by Cloudinary's own models when it computes a
 * `g_auto` crop: the region it considers the subject (`g_auto_info`) and any
 * facial landmarks it detected. VisualOps converts both into percentage
 * rectangles over the original frame.
 */

export interface CloudinaryInsight {
  url: string;
  inputWidth: number;
  inputHeight: number;
  inputBytes: number;
  /** Subject region Cloudinary's g_auto selected, in percent of the frame. */
  focus?: Region;
  /** Approximate face boxes derived from the detected landmarks. */
  faces: Region[];
}

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
          label: 'g_auto',
        }
      : undefined,
    faces,
  };
}

const cache = new Map<string, Promise<CloudinaryInsight>>();

export function fetchInsight(asset: MediaAsset): Promise<CloudinaryInsight> {
  const url = insightUrl(asset);
  const cached = cache.get(url);
  if (cached) return cached;
  const promise = fetch(url)
    .then(async (res) => {
      if (!res.ok) {
        throw new Error(res.headers.get('x-cld-error') ?? `fl_getinfo returned HTTP ${res.status}`);
      }
      return parseInsight(url, (await res.json()) as GetInfoResponse);
    })
    .catch((error: unknown) => {
      cache.delete(url);
      throw error;
    });
  cache.set(url, promise);
  return promise;
}
