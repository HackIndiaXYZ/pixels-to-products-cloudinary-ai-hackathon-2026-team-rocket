import type { ResourceType } from '@/lib/types';

/**
 * Minimal, dependency-free builder for Cloudinary delivery URLs.
 *
 * Components are emitted with their parameters sorted alphabetically, which is
 * the same canonical order the Cloudinary Node/Python SDKs produce. That keeps
 * the URLs VisualOps renders byte-identical to the SDK code it exports
 * (verified by `npm run verify:cloudinary`).
 */

export const DELIVERY_ORIGIN = 'https://res.cloudinary.com';

export interface MediaRef {
  cloudName: string;
  publicId: string;
  resourceType: ResourceType;
}

export type ParamValue = string | number | undefined | null | false;

/** Builds one transformation component, e.g. `ar_16:9,c_fill,g_auto,w_1600`. */
export function component(params: Record<string, ParamValue>): string {
  return Object.keys(params)
    .filter((key) => {
      const value = params[key];
      return value !== undefined && value !== null && value !== false && value !== '';
    })
    .sort()
    .map((key) => `${key}_${params[key]}`)
    .join(',');
}

export function encodePublicId(publicId: string): string {
  return publicId.split('/').map(encodeURIComponent).join('/');
}

/**
 * Generative AI prompts are embedded in the URL path. Characters that act as
 * separators in transformation syntax (`,` `/` `:` `;` `_`) are stripped so a
 * prompt can never break out of its parameter.
 */
export function sanitizePrompt(text: string, max = 140): string {
  return text
    .replace(/[^\p{L}\p{N} .'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function encodePrompt(text: string): string {
  return encodeURIComponent(sanitizePrompt(text));
}

/**
 * Text overlays: URL-encode, then double-escape commas and slashes as the
 * Cloudinary text-layer syntax requires.
 */
export function encodeOverlayText(text: string): string {
  return encodeURIComponent(text.slice(0, 120))
    .replace(/%2C/gi, '%252C')
    .replace(/%2F/gi, '%252F');
}

/** Accepts `#ff6a00`, `ff6a00` or a plain colour name. */
export function sanitizeColor(value: string, fallback = 'FFFFFF'): string {
  const v = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) return v.toUpperCase();
  if (/^[a-z]{3,20}$/i.test(v)) return v.toLowerCase();
  return fallback;
}

export function sanitizeFileName(value: string): string {
  return (
    value
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[^a-z0-9-]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'visualops-asset'
  );
}

export function deliveryUrl(ref: MediaRef, components: string[] = [], extension?: string): string {
  const path = [
    DELIVERY_ORIGIN,
    encodeURIComponent(ref.cloudName),
    ref.resourceType,
    'upload',
    ...components.filter(Boolean),
    encodePublicId(ref.publicId),
  ].join('/');
  return extension ? `${path}.${extension}` : path;
}

/** Adds `fl_attachment` so Cloudinary serves the file with a download disposition. */
export function attachmentComponents(components: string[], fileName: string): string[] {
  return [...components, `fl_attachment:${sanitizeFileName(fileName)}`];
}

/** Splits a delivery URL back into its transformation components (used for display). */
export function transformationFromUrl(url: string): string[] {
  const match = url.match(/\/(image|video)\/upload\/(.+)$/);
  if (!match) return [];
  const segments = match[2].split('/');
  // The last segment is the public id (possibly preceded by folder segments).
  return segments.filter((segment) => /^[a-z]{1,3}_/.test(segment) && segment.includes('_'));
}
