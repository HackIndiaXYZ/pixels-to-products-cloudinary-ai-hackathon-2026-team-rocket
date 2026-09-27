import type { Category, MediaAsset, Region } from '@/lib/types';
import { CATEGORIES, fieldAssets, findingRecords, severityCounts, siteSummaries, sitesOf } from '@/lib/analytics';
import { displayUrl, frameUrl, isVideo } from '@/lib/cloudinary/media';
import { parseQuery, runQuery } from '@/lib/search/query';
import { evidenceStillUrl } from '@/lib/report';
import { LANDING_ASSETS, landingAsset } from '../landing-data';

/**
 * Everything the platform story shows is derived here from the same sample
 * dataset the console uses. Nothing is invented for the animation: search
 * matches come from the real parser, ranks and counts from the analytics module.
 */

/** Scroll progress at which each of the six stages begins (last entry = end). */
export const BOUNDS = [0, 0.16, 0.33, 0.5, 0.66, 0.83, 1] as const;

export interface StageCopy {
  id: string;
  word: string;
  title: string;
  body: string;
  tech: string;
}

export const STAGES: StageCopy[] = [
  {
    id: 'raw',
    word: 'Raw media',
    title: 'Raw media',
    body: 'Phone photos, drone passes and CCTV exports arrive with a file name and nothing else.',
    tech: 'Stored and delivered by Cloudinary · video frames pulled at a start offset (so_<seconds>)',
  },
  {
    id: 'understand',
    word: 'Understand',
    title: 'Understand',
    body: 'Cloudinary positions subject-aware crops and detects faces; captures are corrected, nothing invented.',
    tech: 'g_auto · fl_getinfo · e_improve · e_pixelate_faces',
  },
  {
    id: 'structure',
    word: 'Structure',
    title: 'Structure',
    body: 'Every capture becomes a record: site, zone, category, severity, status and next action.',
    tech: 'Carried into Cloudinary as tags + context metadata',
  },
  {
    id: 'search',
    word: 'Search',
    title: 'Search',
    body: 'Ask in plain language. VisualOps shows exactly how it read the question.',
    tech: 'Transparent query parser · no black box',
  },
  {
    id: 'insight',
    word: 'Insight',
    title: 'Insight',
    body: 'Risk is ranked from the records, not guessed. The worst open finding surfaces first.',
    tech: 'Aggregated by site · category · severity',
  },
  {
    id: 'action',
    word: 'Action',
    title: 'Action',
    body: 'A stamped evidence frame, with any faces Cloudinary detects pixelated, and a SHA-256 fingerprint, ready to hand over.',
    tech: 'l_text stamp · e_pixelate_faces · SHA-256 in the browser',
  },
];

/**
 * Kinetic settings of the giant stage word, per stage: Archivo width axis,
 * tracking (em) and weight at the start → end of the stage.
 */
export interface WordStyle {
  wdth: [number, number];
  track: [number, number];
  wght: [number, number];
  /** Rendered as a dim, recessed fill (a structural backdrop rather than a headline). */
  dim?: boolean;
}

export const WORD_STYLES: WordStyle[] = [
  { wdth: [62, 104], track: [0.09, -0.01], wght: [800, 800] },
  { wdth: [96, 125], track: [-0.02, 0.01], wght: [260, 800] },
  { wdth: [84, 62], track: [0.03, -0.03], wght: [800, 800] },
  { wdth: [112, 84], track: [0.3, 0], wght: [700, 800] },
  { wdth: [62, 125], track: [-0.02, 0], wght: [800, 800], dim: true },
  { wdth: [125, 90], track: [-0.01, -0.035], wght: [900, 900] },
];

/* ------------------------------------------------------------------------ */
/* Dataset facts                                                             */
/* ------------------------------------------------------------------------ */

const STORY_NOW = Date.UTC(2026, 8, 26, 9, 0, 0);

export const FIELD: MediaAsset[] = fieldAssets(LANDING_ASSETS);
export const SITES = sitesOf(LANDING_ASSETS);
export const RECORDS = findingRecords(LANDING_ASSETS);
export const COUNTS = severityCounts(RECORDS);
export const DATASET = {
  captures: FIELD.length,
  videos: FIELD.filter(isVideo).length,
  sites: SITES.length,
};

/**
 * The demo question. "Severe" is mapped by the parser to critical + high, so
 * the ranked result set leads with the one critical finding the story follows.
 */
export const STORY_QUERY = 'Severe structural issues';
export const QUERY_PARSED = parseQuery(STORY_QUERY, SITES, STORY_NOW);
export const QUERY_RESULT = runQuery(QUERY_PARSED, FIELD);
export const MATCH_IDS = new Set(QUERY_RESULT.hits.map((h) => h.asset.id));

/** The finding the story follows into Insight and Action (the top-ranked hit). */
export const HERO: MediaAsset = landingAsset('vo-road-collapse');
export const HERO_RANK = RECORDS.findIndex((r) => r.asset.id === HERO.id) + 1;
export const HERO_SITE = siteSummaries(RECORDS).find((s) => s.site === HERO.site);
export const HERO_ASPECT = HERO.width / HERO.height;

/** Understood tokens (lower-case) — used to underline the words the parser consumed. */
export const UNDERSTOOD = new Set(QUERY_PARSED.understood.map((u) => u.toLowerCase()));

/* ------------------------------------------------------------------------ */
/* Tiles                                                                     */
/* ------------------------------------------------------------------------ */

export interface TileSpec {
  key: string;
  asset: MediaAsset;
  /** Seconds into the video for extra frames; null for the capture itself. */
  frame: number | null;
  src: string;
  aspect: number;
  caption: string;
  category: Category;
  /** The capture itself (its annotation region and Cloudinary insight map onto the tile). */
  primary: boolean;
  hero: boolean;
  match: boolean;
  region?: Region;
}

/**
 * Extra frames grabbed from the videos with Cloudinary `so_` — offsets stay inside
 * each clip. Only frames that look different from their capture's own still:
 * the 90 s equipment-yard sweep and the montage cut of the Line C clip (its
 * still is so_3). Short clips (the drone pass, the hot-work and CCTV shots)
 * would only repeat near-identical frames.
 */
const FRAME_PLAN: Array<[string, number]> = [
  ['vo-equipment-yard', 14],
  ['vo-equipment-yard', 36],
  ['vo-equipment-yard', 58],
  ['vo-equipment-yard', 80],
  ['vo-plant-walkthrough', 1.2],
];

const LOW_IDS = [
  'vo-road-collapse',
  'vo-demolition-deck',
  'vo-bridge-truss',
  'vo-crew-ppe',
  'vo-wet-floor',
  'vo-hot-work',
  'vo-fleet-dash',
  'vo-fleet-checkin',
  'vo-equipment-yard',
  'vo-ole-survey',
  'vo-washroom-panel',
  'vo-receiving-label',
];

function primaryTile(asset: MediaAsset): TileSpec {
  const hero = asset.id === HERO.id;
  return {
    key: asset.id,
    asset,
    frame: null,
    // c_limit keeps the full frame, so annotation regions and g_auto boxes map exactly.
    src: displayUrl(asset, hero ? 1000 : 400),
    aspect: asset.width / asset.height,
    caption: asset.fileName,
    category: asset.finding?.category ?? 'facilities',
    primary: true,
    hero,
    match: MATCH_IDS.has(asset.id),
    region: asset.finding?.region,
  };
}

function frameTile(asset: MediaAsset, seconds: number): TileSpec {
  return {
    key: `${asset.id}@${seconds}`,
    asset,
    frame: seconds,
    src: frameUrl(asset, seconds, 400, 225),
    aspect: 16 / 9,
    caption: `${asset.fileName} · so_${seconds}`,
    category: asset.finding?.category ?? 'facilities',
    primary: false,
    hero: false,
    // Search matches records, one per capture: only the capture's own tile lights
    // up, so the lit tiles always equal the "N of M captures match" count.
    match: false,
  };
}

export const TILES_HIGH: TileSpec[] = [
  ...FIELD.map(primaryTile),
  ...FRAME_PLAN.map(([id, t]) => frameTile(landingAsset(id), t)),
];
export const TILES_LOW: TileSpec[] = LOW_IDS.map((id) => primaryTile(landingAsset(id)));

export const PRIMARY_HIGH: MediaAsset[] = TILES_HIGH.filter((t) => t.primary).map((t) => t.asset);
export const PRIMARY_LOW: MediaAsset[] = TILES_LOW.filter((t) => t.primary).map((t) => t.asset);

export interface TileGroup {
  category: Category;
  indices: number[];
  /** Records (captures) in this category — frames belong to their capture's record. */
  records: number;
}

export function groupTiles(tiles: TileSpec[]): TileGroup[] {
  return CATEGORIES.map((category) => {
    const indices = tiles.map((t, i) => (t.category === category ? i : -1)).filter((i) => i >= 0);
    return { category, indices, records: indices.filter((i) => tiles[i].primary).length };
  }).filter((g) => g.indices.length > 0);
}

export const GROUPS_HIGH = groupTiles(TILES_HIGH);
export const GROUPS_LOW = groupTiles(TILES_LOW);

/* ------------------------------------------------------------------------ */
/* Report payload (hashed in the browser)                                    */
/* ------------------------------------------------------------------------ */

/**
 * The story finding's evidence frame as Cloudinary renders it for a report
 * (e_improve, e_pixelate_faces on any faces it detects, burned-in audit stamp).
 * Sample media stamps `SAMPLE` instead of a capture day, so the URL is the same
 * on the server and in every browser and needs no client-only render pass.
 */
export const EVIDENCE_SRC = evidenceStillUrl(HERO, true, 900);

/**
 * The fixed SAMPLE report payload the story's SHA-256 is computed over — labelled "sample report payload" on
 * the sheet. It is not a console export (that is `visualops.report/v3`, built by lib/report): it lists the
 * search result's sample annotations and, as the one evidence frame, exactly the URL the sheet displays
 * (callers pass the same `EVIDENCE_SRC` to the sheet and to the hash). No report runs on the landing page, so
 * it carries no delivery results.
 */
export function reportJson(evidenceUrl: string): string {
  return JSON.stringify({
    schema: 'visualops.sample-report/v1',
    sample: 'Sample report payload for the landing story. Findings are sample annotations written by the VisualOps team.',
    kind: 'inspection',
    query: STORY_QUERY,
    findings: QUERY_RESULT.hits.map(({ asset }) => ({
      id: asset.finding?.id,
      title: asset.finding?.title,
      severity: asset.finding?.severity,
      category: asset.finding?.category,
      status: asset.finding?.status,
      site: asset.site,
      zone: asset.zone,
      file: asset.fileName,
      provenance: 'human · sample annotation',
      evidence: asset.id === HERO.id ? evidenceUrl : undefined,
    })),
  });
}
