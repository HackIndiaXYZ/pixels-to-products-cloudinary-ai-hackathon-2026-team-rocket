import type { MediaAsset } from '@/lib/types';
import { attachmentComponents, component, deliveryUrl, type MediaRef } from './url';

/**
 * Asset-level URL helpers. Every URL here is a real Cloudinary delivery URL:
 * resizing, cropping, frame extraction and format negotiation all happen on
 * Cloudinary, never in the browser.
 */

export function refOf(asset: MediaAsset): MediaRef {
  return { cloudName: asset.cloudName, publicId: asset.publicId, resourceType: asset.resourceType };
}

export function isVideo(asset: MediaAsset): boolean {
  return asset.resourceType === 'video';
}

/** Frame offset used to derive stills from video (Cloudinary `so_`). */
export function posterOffset(asset: MediaAsset): number {
  return asset.posterOffset ?? 1;
}

/** Leading components for a still image: nothing for images, a frame grab for video. */
export function stillBase(asset: MediaAsset): string[] {
  return isVideo(asset) ? [component({ so: posterOffset(asset) })] : [];
}

function stillExtension(asset: MediaAsset): string | undefined {
  return isVideo(asset) ? 'jpg' : undefined;
}

/** Cropped thumbnail, subject kept in frame by Cloudinary's `g_auto`. */
export function thumbUrl(asset: MediaAsset, width: number, height: number): string {
  return deliveryUrl(
    refOf(asset),
    [...stillBase(asset), component({ c: 'fill', g: 'auto', w: width, h: height }), 'q_auto', 'f_auto'],
    stillExtension(asset),
  );
}

/** Full frame, width-limited, automatic quality and format. */
export function displayUrl(asset: MediaAsset, width = 1600): string {
  return deliveryUrl(
    refOf(asset),
    [...stillBase(asset), component({ c: 'limit', w: width }), 'q_auto', 'f_auto'],
    stillExtension(asset),
  );
}

/** Responsive srcset for a still. */
export function displaySrcSet(asset: MediaAsset, widths: number[] = [480, 800, 1200, 1600, 2000]): string {
  const usable = widths.filter((w) => w <= Math.max(asset.width, 480));
  return (usable.length ? usable : [widths[0]])
    .map((w) => `${displayUrl(asset, w)} ${w}w`)
    .join(', ');
}

/**
 * The untouched original rendition. For images this is the stored file
 * (optionally size-capped, format and quality unchanged); for video it is the
 * original stream transcoded only as far as the browser needs to play it.
 */
export function originalUrl(asset: MediaAsset, maxWidth?: number): string {
  if (isVideo(asset)) {
    return deliveryUrl(refOf(asset), [], 'mp4');
  }
  return deliveryUrl(refOf(asset), maxWidth ? [component({ c: 'limit', w: maxWidth })] : []);
}

/** Video playback rendition: resized, automatic quality and codec, MP4 container. */
export function playbackUrl(asset: MediaAsset, width = 1280): string {
  return deliveryUrl(refOf(asset), [component({ c: 'limit', w: width }), 'q_auto', 'vc_auto'], 'mp4');
}

/**
 * Short silent preview for hover states: trimmed, cropped and transcoded by
 * Cloudinary (centre crop — g_auto on video would trigger async tracking).
 */
export function hoverClipUrl(asset: MediaAsset, width = 640, height = 400): string {
  return deliveryUrl(
    refOf(asset),
    [component({ du: 4, so: posterOffset(asset) }), component({ c: 'fill', h: height, w: width }), 'ac_none', 'q_auto', 'vc_auto'],
    'mp4',
  );
}

/** A still extracted from a video at an arbitrary offset. */
export function frameUrl(asset: MediaAsset, seconds: number, width = 480, height = 270): string {
  return deliveryUrl(
    refOf(asset),
    [component({ so: Math.max(0, Math.round(seconds * 10) / 10) }), component({ c: 'fill', g: 'auto', w: width, h: height }), 'q_auto', 'f_auto'],
    'jpg',
  );
}

/**
 * Cloudinary `fl_getinfo`: returns JSON describing the input, the g_auto
 * subject region and any detected facial landmarks.
 */
export function insightUrl(asset: MediaAsset): string {
  return deliveryUrl(
    refOf(asset),
    [...stillBase(asset), component({ ar: '1:1', c: 'fill', g: 'auto', w: 600 }), 'fl_getinfo'],
    stillExtension(asset),
  );
}

/** The frame as captured: for video, a plain frame grab; for images, the original resized only. */
export function rawStillUrl(asset: MediaAsset, width = 1600): string {
  return deliveryUrl(refOf(asset), [...stillBase(asset), component({ c: 'limit', w: width })], stillExtension(asset));
}

/** Evidence view: exposure and sharpness correction only — no generated pixels. */
export function evidenceUrl(asset: MediaAsset, width = 1600): string {
  return deliveryUrl(
    refOf(asset),
    [...stillBase(asset), component({ c: 'limit', w: width }), 'e_improve', 'e_sharpen:60', 'q_auto', 'f_auto'],
    stillExtension(asset),
  );
}

/** Faces pixelated by Cloudinary before media leaves the team. */
export function redactedUrl(asset: MediaAsset, width = 1600): string {
  return deliveryUrl(
    refOf(asset),
    [...stillBase(asset), component({ c: 'limit', w: width }), 'e_pixelate_faces:20', 'q_auto', 'f_auto'],
    stillExtension(asset),
  );
}

/** Download of the original file (Cloudinary sets Content-Disposition). */
export function downloadOriginalUrl(asset: MediaAsset): string {
  const ext = isVideo(asset) ? 'mp4' : undefined;
  return deliveryUrl(refOf(asset), attachmentComponents([], asset.fileName), ext);
}
