import type { MediaAsset } from '@/lib/types';
import { buildSampleAssets } from '@/lib/data/dataset';

/**
 * Landing page uses the same Cloudinary-hosted sample assets as the console.
 * Dates are never rendered here, so a fixed clock keeps server and client identical.
 */
const FIXED_NOW = Date.UTC(2026, 8, 26, 9, 0, 0);
export const LANDING_ASSETS: MediaAsset[] = buildSampleAssets(FIXED_NOW);

export function landingAsset(id: string): MediaAsset {
  const asset = LANDING_ASSETS.find((a) => a.id === id);
  if (!asset) throw new Error(`Unknown landing asset ${id}`);
  return asset;
}
