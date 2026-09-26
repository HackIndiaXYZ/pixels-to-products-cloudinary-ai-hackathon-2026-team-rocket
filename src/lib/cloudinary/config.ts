import type { CloudSettings } from '@/lib/types';

/** Cloudinary's public demo cloud. The bundled sample dataset lives here. */
export const DEMO_CLOUD = 'demo';

/**
 * Build-time configuration. Only public values: a cloud name and an *unsigned*
 * upload preset. VisualOps never needs an API key or secret.
 */
export const ENV_SETTINGS: CloudSettings = {
  cloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME?.trim() || DEMO_CLOUD,
  uploadPreset: process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET?.trim() || '',
  tag: process.env.NEXT_PUBLIC_VISUALOPS_TAG?.trim() || 'visualops',
};

export function canUpload(settings: CloudSettings): boolean {
  return Boolean(settings.cloudName && settings.uploadPreset);
}

export function isValidCloudName(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{1,62}$/i.test(value.trim());
}

export function isValidTag(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,62}$/i.test(value.trim());
}
