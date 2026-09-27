import type { MediaAsset } from '@/lib/types';
import { component, deliveryUrl } from './url';

/**
 * A texture atlas composed by Cloudinary in a single request: every tile is an
 * image layer (`l_<public_id>`) cropped with `g_auto` and placed on a grid with
 * `fl_layer_apply`. The landing page's WebGL field samples this texture, so even
 * the atmosphere is built from the operational media, by Cloudinary.
 */

export interface AtlasTile {
  assetId: string;
  col: number;
  row: number;
}

export interface AtlasSpec {
  url: string;
  tile: number;
  cols: number;
  rows: number;
  tiles: AtlasTile[];
}

/** Layer public IDs use `:` instead of `/` for folders. */
const layerId = (publicId: string) => publicId.replace(/\//g, ':');

export function buildAtlas(assets: MediaAsset[], options: { tile?: number; cols?: number; rows?: number } = {}): AtlasSpec {
  const tile = options.tile ?? 256;
  const cols = options.cols ?? 4;
  const rows = options.rows ?? 4;
  // Image layers only: video frames cannot be layered onto an image base.
  const images = assets.filter((a) => a.resourceType === 'image' && a.collection !== 'reference');
  if (!images.length) throw new Error('buildAtlas needs at least one image asset');

  const tiles: AtlasTile[] = [];
  const components: string[] = [component({ c: 'fill', h: tile * rows, w: tile * cols })];
  for (let i = 0; i < cols * rows; i += 1) {
    const asset = images[i % images.length];
    const col = i % cols;
    const row = Math.floor(i / cols);
    tiles.push({ assetId: asset.id, col, row });
    components.push(
      `l_${layerId(asset.publicId)}`,
      component({ c: 'fill', g: 'auto', h: tile, w: tile }),
      component({ fl: 'layer_apply', g: 'north_west', x: col * tile, y: row * tile }),
    );
  }
  components.push('q_auto:good', 'f_auto');
  const base = images[0];
  return {
    url: deliveryUrl({ cloudName: base.cloudName, publicId: base.publicId, resourceType: 'image' }, components),
    tile,
    cols,
    rows,
    tiles,
  };
}
