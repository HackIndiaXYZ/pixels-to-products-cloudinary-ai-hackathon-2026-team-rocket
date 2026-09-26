import type { MediaAsset } from '@/lib/types';
import { displayUrl, isVideo, redactedUrl, refOf, stillBase, thumbUrl } from '@/lib/cloudinary/media';
import { component, deliveryUrl } from '@/lib/cloudinary/url';

/**
 * Rendition sets for the editorial sections. Every candidate is a Cloudinary
 * delivery URL sized to its slot; the browser picks one from `srcSet`/`sizes`,
 * so exactly one rendition per tile is downloaded.
 */

export interface MediaSource {
  src: string;
  srcSet?: string;
  sizes?: string;
  /** CSS aspect-ratio of the rendered tile, e.g. "16 / 10". */
  aspect: string;
  /** Cloudinary components worth naming in a caption (display only). */
  recipe: string;
}

/** Widths that do not exceed what the source can provide (no pointless upscaling). */
function usableWidths(widths: number[], max: number): number[] {
  const usable = widths.filter((w) => w <= max * 1.05);
  return usable.length ? usable : [Math.min(widths[0], Math.round(max))];
}

/** Subject-aware crop (g_auto) to a fixed ratio; optionally with Cloudinary face pixelation. */
export function cropSource(
  asset: MediaAsset,
  ratio: [number, number],
  widths: number[],
  sizes: string,
  options: { redactFaces?: boolean } = {},
): MediaSource {
  const [rw, rh] = ratio;
  const maxWidth = Math.min(asset.width, (asset.height * rw) / rh);
  const list = usableWidths(widths, maxWidth);
  const url = (w: number) => {
    const h = Math.round((w * rh) / rw);
    if (!options.redactFaces) return thumbUrl(asset, w, h);
    return deliveryUrl(
      refOf(asset),
      [...stillBase(asset), component({ c: 'fill', g: 'auto', h, w }), 'e_pixelate_faces:20', 'q_auto', 'f_auto'],
      isVideo(asset) ? 'jpg' : undefined,
    );
  };
  return {
    src: url(list[Math.min(1, list.length - 1)]),
    srcSet: list.map((w) => `${url(w)} ${w}w`).join(', '),
    sizes,
    aspect: `${rw} / ${rh}`,
    recipe: options.redactFaces ? 'c_fill,g_auto · e_pixelate_faces' : 'c_fill,g_auto',
  };
}

/** The full frame at its native aspect ratio (c_limit), optionally face-redacted. */
export function nativeSource(
  asset: MediaAsset,
  widths: number[],
  sizes: string,
  options: { redactFaces?: boolean } = {},
): MediaSource {
  const list = usableWidths(widths, asset.width);
  const url = (w: number) => (options.redactFaces ? redactedUrl(asset, w) : displayUrl(asset, w));
  return {
    src: url(list[Math.min(1, list.length - 1)]),
    srcSet: list.map((w) => `${url(w)} ${w}w`).join(', '),
    sizes,
    aspect: `${asset.width} / ${asset.height}`,
    recipe: options.redactFaces ? 'c_limit · e_pixelate_faces' : 'c_limit',
  };
}

/** The capture at its native pixel dimensions (no srcset), meant to be shown 1:1. */
export function captureSizeSource(asset: MediaAsset): MediaSource {
  return {
    src: displayUrl(asset, asset.width),
    aspect: `${asset.width} / ${asset.height}`,
    recipe: 'c_limit at capture size',
  };
}

/** Megapixels, formatted for display ("12.2", "0.07"). */
export function megapixels(asset: MediaAsset): string {
  const mp = (asset.width * asset.height) / 1_000_000;
  return mp >= 1 ? mp.toFixed(1) : mp.toFixed(2);
}

/** mm:ss for a video offset. */
export function timecode(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}
