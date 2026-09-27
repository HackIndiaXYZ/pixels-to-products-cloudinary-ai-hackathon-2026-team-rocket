import { buildAtlas } from '@/lib/cloudinary/atlas';
import { LANDING_ASSETS } from '../landing-data';

/**
 * The texture behind the hero's data field: the field images, cropped with
 * g_auto and composited into one 4×4 atlas by Cloudinary in a single request.
 * Deterministic, so server and client agree on the URL.
 */
export const FIELD_ATLAS = buildAtlas(LANDING_ASSETS);

/** Distinct field images tiled into the atlas. */
export const FIELD_ATLAS_SOURCES = new Set(FIELD_ATLAS.tiles.map((t) => t.assetId)).size;
