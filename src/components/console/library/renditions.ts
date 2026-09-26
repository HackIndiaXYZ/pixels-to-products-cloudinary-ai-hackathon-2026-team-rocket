import type { MediaAsset } from '@/lib/types';
import { displayUrl, evidenceUrl, playbackUrl, redactedUrl } from '@/lib/cloudinary/media';
import { IMAGE_ACCEPT, measure } from '@/lib/cloudinary/probe';
import { encodePublicId } from '@/lib/cloudinary/url';

/**
 * The renditions the Inspector stages, and the small amount of prefetching the
 * Library does when a viewer shows intent to open one. Every URL is a real
 * Cloudinary delivery URL; nothing here is simulated.
 */

export type StillView = 'original' | 'evidence' | 'redacted';

/** Width limit of the stage renditions (matches what the console measures for delivery totals). */
export const STAGE_WIDTH = 1600;

export const VIEW_INFO: Record<StillView, { label: string; title: string; integrity: string }> = {
  original: {
    label: 'Original',
    title: 'The stored frame, resized for the screen only',
    integrity: 'Resized and format-negotiated only. Every pixel is as captured.',
  },
  evidence: {
    label: 'Evidence view',
    title: 'e_improve + e_sharpen: exposure and edge correction, nothing generated',
    integrity: 'Exposure and sharpness corrected. No content is added or removed.',
  },
  redacted: {
    label: 'Faces redacted',
    title: 'e_pixelate_faces: Cloudinary detects and pixelates faces',
    integrity: 'Detected faces pixelated for sharing. No content is generated.',
  },
};

export function stageUrl(asset: MediaAsset, view: StillView = 'original'): string {
  if (asset.resourceType === 'video') return playbackUrl(asset);
  if (view === 'evidence') return evidenceUrl(asset, STAGE_WIDTH);
  if (view === 'redacted') return redactedUrl(asset, STAGE_WIDTH);
  return displayUrl(asset, STAGE_WIDTH);
}

/** A small full-frame rendition shown the instant the Inspector opens, under the stage rendition. */
export function underlayUrl(asset: MediaAsset): string {
  return displayUrl(asset, 480);
}

export function posterUrl(asset: MediaAsset): string {
  return displayUrl(asset, 1280);
}

const prefetched = new Set<string>();

function prefetchImage(url: string): void {
  if (prefetched.has(url) || typeof Image === 'undefined') return;
  prefetched.add(url);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
}

/**
 * `intent` (hover dwell / focus): fetch the small underlay so the morph never
 * lands on an empty frame. `commit` (pointer down): start Cloudinary's HEAD
 * probe and the stage rendition itself, a few hundred ms before the click lands.
 */
export function warmInspector(asset: MediaAsset, stage: 'intent' | 'commit'): void {
  prefetchImage(underlayUrl(asset));
  if (stage !== 'commit') return;
  const isVideo = asset.resourceType === 'video';
  const url = stageUrl(asset);
  void measure(url, { accept: isVideo ? undefined : IMAGE_ACCEPT });
  prefetchImage(isVideo ? posterUrl(asset) : url);
}

/** The transformation components of a delivery URL (everything between `/upload/` and the public ID). */
export function renditionComponents(url: string, asset: MediaAsset): string[] {
  const marker = `/${asset.resourceType}/upload/`;
  const start = url.indexOf(marker);
  if (start < 0) return [];
  const rest = url.slice(start + marker.length);
  const end = rest.lastIndexOf(encodePublicId(asset.publicId));
  return (end >= 0 ? rest.slice(0, end) : rest).split('/').filter(Boolean);
}

export function renditionExtension(url: string): string | undefined {
  const match = url.match(/\.([a-z0-9]{2,4})$/i);
  return match ? match[1].toLowerCase() : undefined;
}

const PARAM_NOTE: Record<string, (value: string) => string> = {
  so: (v) => `frame at ${v} s`,
  du: (v) => `${v} s long`,
  w: (v) => `${v} px wide`,
  h: (v) => `${v} px high`,
  ar: (v) => `${v} aspect`,
};

/** A short, literal explanation of one transformation component. */
export function describeComponent(component: string): string {
  const parts = component.split(',');
  const notes: string[] = [];
  for (const part of parts) {
    const [key, ...rest] = part.split('_');
    const value = rest.join('_');
    if (key === 'c') {
      notes.push(value === 'limit' ? 'fit, never upscale' : value === 'fill' ? 'crop to fill' : value === 'scale' ? 'scale' : `crop ${value}`);
    } else if (key === 'g') {
      notes.push(value === 'auto' ? 'subject kept in frame (g_auto)' : `gravity ${value}`);
    } else if (key === 'q' && value === 'auto') {
      notes.push('automatic quality');
    } else if (key === 'f' && value === 'auto') {
      notes.push('best format for this browser');
    } else if (key === 'vc' && value === 'auto') {
      notes.push('automatic video codec');
    } else if (key === 'ac' && value === 'none') {
      notes.push('audio removed');
    } else if (key === 'e') {
      if (value === 'improve' || value.startsWith('improve:')) notes.push('auto exposure and colour');
      else if (value.startsWith('sharpen')) notes.push('edge sharpening');
      else if (value.startsWith('pixelate_faces')) notes.push('detected faces pixelated');
      else notes.push('effect');
    } else if (PARAM_NOTE[key]) {
      notes.push(PARAM_NOTE[key](value));
    }
  }
  return notes.join(' · ');
}
