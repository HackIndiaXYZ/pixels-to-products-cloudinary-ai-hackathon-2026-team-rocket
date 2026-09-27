import { clamp, lerp } from '@/components/motion/hooks';
import type { TileGroup, TileSpec } from './data';

/**
 * Pure stage geometry for the platform story. Computed on resize only; the
 * per-frame renderer just interpolates between these precomputed keyframes.
 * All randomness comes from a seeded PRNG, so a given viewport always gets
 * the same "chaos".
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Tile pose: centre (px), displayed width (px) and rotation (deg). */
export interface Pose {
  x: number;
  y: number;
  w: number;
  r: number;
}

export interface TileLayout {
  /** Base box: the largest size the tile is ever shown at, so transforms only scale down. */
  bw: number;
  bh: number;
  aspect: number;
  entry: Pose;
  chaos: Pose;
  und: Pose;
  grid: Pose;
  /** RAW stage drift-in start (scroll progress). */
  delay: number;
  /** STRUCTURE flight start (scroll progress). */
  flight: number;
  /** Small rotation during the flight into the grid. */
  spin: number;
  /**
   * The straight flight into the grid would cross the caption block: fly across
   * first, then down into the column (x leads, y follows), which keeps it clear.
   */
  detour: boolean;
  /** Scale compensation so captions, chips and outlines render at a steady size. */
  capFs: number;
  chipFs: number;
  bd: number;
  ring: number;
  /** Hero only: base box ÷ INSIGHT size, so its annotation text reads at its nominal size there. */
  annK: number;
  hero: boolean;
  match: boolean;
  primary: boolean;
}

/** The giant stage word: origin position, scale, alignment (0 = left, 1 = centred) and opacity. */
export interface RigPose {
  x: number;
  y: number;
  s: number;
  a: number;
  o: number;
}

export interface Measures {
  W: number;
  H: number;
  narrow: boolean;
  /** Outer margin. */
  M: number;
  /** First usable y below the site navigation. */
  topY: number;
  /** Left text column width (desktop) or full content width (narrow). */
  colW: number;
  fontPx: number;
  /** Widest rendering of each stage word at `fontPx`. */
  wordW: number[];
  hud: Rect;
  queryH: number;
  insightH: number;
  sheetW: number;
  sheetH: number;
  /** Evidence slot, relative to the sheet's top-left corner. */
  slot: Rect;
}

export interface SceneLayout {
  W: number;
  H: number;
  narrow: boolean;
  tiles: TileLayout[];
  headers: Array<{ x: number; y: number; w: number }>;
  heroPose: Pose;
  recede: { x: number; y: number };
  rig: RigPose[];
  query: { x: number; y: number };
  insight: { x: number; y: number };
  action: { x: number; y: number };
  /** Report sheet position and scale (1, or less when even its narrowest layout is too tall for the room). */
  sheet: { x: number; y: number; s: number };
  /** How far below its place the report sheet starts its rise. */
  sheetRise: number;
  slot: { cx: number; cy: number; w: number };
  scanFrom: number;
  scanTo: number;
}

/* ------------------------------------------------------------------------ */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export const WORD_LINE = 0.9;

/** Scale that fits stage word `k` inside a box. */
function fitWord(wordW: number[], k: number, fontPx: number, maxW: number, maxH: number): number {
  return Math.max(0.05, Math.min(maxW / Math.max(1, wordW[k]), maxH / (fontPx * WORD_LINE)));
}

/** Scale of the small, top-left stage word (STRUCTURE / SEARCH / ACTION). */
export function cornerWordScale(m: Pick<Measures, 'W' | 'H' | 'narrow' | 'colW' | 'wordW' | 'fontPx'>, k: number): number {
  return m.narrow
    ? fitWord(m.wordW, k, m.fontPx, m.W * 0.62, m.H * 0.075)
    : fitWord(m.wordW, k, m.fontPx, m.colW, m.H * 0.15);
}

/** Scale of the giant INSIGHT word on wide layouts (left-anchored, nearly full width). */
function insightWordScale(m: Measures): number {
  // Leave room for the insight panel between the word and the caption block.
  const room = m.hud.y - m.insightH - 48 - m.topY;
  return fitWord(m.wordW, 4, m.fontPx, m.W * 0.96 - m.M, Math.min(m.H * 0.3, Math.max(m.H * 0.14, room)));
}

/* ------------------------------------------------------------------------ */
/* Keep-out zone for the caption block (HUD)                                  */
/* ------------------------------------------------------------------------ */

/** Tile captions: 9px mono at the scattered size (see `capFs`), 0.45em below the tile. */
const CAPTION_PX = 9;
const CAPTION_CHAR = 0.62;
const CAPTION_H = CAPTION_PX * 1.5;
/** Clear space kept between any scattered tile (or its caption) and the caption block. */
const HUD_CLEAR = 16;

/** Offsets of an axis-aligned bounding box from a tile's centre. */
interface Extents {
  l: number;
  r: number;
  t: number;
  b: number;
}

/**
 * Extents of a tile plus its caption around the tile centre, for a displayed
 * width `w` and rotation `r` (deg). `capScale` is the caption's on-screen size
 * relative to 9px: the caption is laid out inside the tile, so it grows with
 * the tile beyond its scattered size.
 */
function tileExtents(w: number, aspect: number, r: number, captionChars: number, capScale: number): Extents {
  const h = w / aspect;
  const k = capScale;
  const capW = captionChars * CAPTION_PX * CAPTION_CHAR * k;
  // Tile box plus the caption hanging below its left edge; rotation is about the tile centre.
  const x0 = -w / 2;
  const x1 = Math.max(w / 2, -w / 2 + capW);
  const y0 = -h / 2;
  const y1 = h / 2 + CAPTION_H * k;
  const rad = (r * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const out: Extents = { l: Infinity, r: -Infinity, t: Infinity, b: -Infinity };
  for (const [px, py] of [
    [x0, y0],
    [x1, y0],
    [x0, y1],
    [x1, y1],
  ]) {
    const x = px * cos - py * sin;
    const y = px * sin + py * cos;
    out.l = Math.min(out.l, x);
    out.r = Math.max(out.r, x);
    out.t = Math.min(out.t, y);
    out.b = Math.max(out.b, y);
  }
  return out;
}

function unionExtents(a: Extents, b: Extents): Extents {
  return { l: Math.min(a.l, b.l), r: Math.max(a.r, b.r), t: Math.min(a.t, b.t), b: Math.max(a.b, b.b) };
}

/** Does a tile centred at (x, y) with extents `e` reach into the caption block's keep-out zone? */
function overHud(x: number, y: number, e: Extents, hud: Rect): boolean {
  return x + e.r > hud.x - HUD_CLEAR && x + e.l < hud.x + hud.w + HUD_CLEAR && y + e.b > hud.y - HUD_CLEAR;
}

/**
 * Does a straight move from → to (linear in x/y/w/r) sweep across the caption
 * block? `fromK` skips the start of the move (e.g. while a drifting tile is
 * still nearly transparent); `capBase` is the width at which the caption reads 9px.
 */
function pathCrossesHud(from: Pose, to: Pose, aspect: number, captionChars: number, capBase: number, hud: Rect, fromK = 0): boolean {
  for (let i = 0; i <= 15; i++) {
    const k = fromK + ((1 - fromK) * i) / 15;
    const w = lerp(from.w, to.w, k);
    const e = tileExtents(w, aspect, lerp(from.r, to.r, k), captionChars, w / capBase);
    if (overHud(lerp(from.x, to.x, k), lerp(from.y, to.y, k), e, hud)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------------ */

interface GridResult {
  poses: Pose[];
  headers: Array<{ x: number; y: number; w: number }>;
  tileW: number;
  col: number[];
}

/** Masonry of category groups: one column per category when they fit, shortest-column packing otherwise. */
function gridPlacement(rect: Rect, groups: TileGroup[], tiles: TileSpec[], cols: number, gap: number, headerH: number): GridResult {
  const colW = (rect.w - gap * (cols - 1)) / cols;
  const run = (scale: number) => {
    const tileW = colW * scale;
    const g = gap * Math.max(0.55, scale);
    const heights = new Array<number>(cols).fill(0);
    const poses: Pose[] = new Array(tiles.length);
    const col: number[] = new Array(tiles.length).fill(0);
    const headers: Array<{ x: number; y: number; w: number }> = [];
    groups.forEach((group, gi) => {
      const c = cols >= groups.length ? gi : heights.indexOf(Math.min(...heights));
      const colX = rect.x + c * (colW + gap);
      let y = heights[c];
      headers.push({ x: colX, y: rect.y + y, w: colW });
      y += headerH;
      for (const i of group.indices) {
        const h = tileW / tiles[i].aspect;
        poses[i] = { x: colX + tileW / 2, y: rect.y + y + h / 2, w: tileW, r: 0 };
        col[i] = c;
        y += h + g;
      }
      heights[c] = y - g + headerH;
    });
    return { poses, headers, tileW, col, total: Math.max(...heights) - headerH };
  };
  let scale = 1;
  let res = run(scale);
  for (let k = 0; k < 4 && res.total > rect.h; k++) {
    scale = Math.max(0.3, scale * (rect.h / res.total) * 0.99);
    res = run(scale);
  }
  return res;
}

/* ------------------------------------------------------------------------ */

export function computeLayout(m: Measures, tiles: TileSpec[], groups: TileGroup[], heroAspect: number): SceneLayout {
  const { W, H, narrow, M, topY, colW, hud, fontPx, wordW } = m;
  const lineH = fontPx * WORD_LINE;
  const rand = mulberry32(0x5eed1e + tiles.length * 7919);

  /* Stage word anchors ---------------------------------------------------- */
  const s2 = cornerWordScale(m, 2);
  const s3 = cornerWordScale(m, 3);
  const s5 = cornerWordScale(m, 5);

  /* Search panel + grid ------------------------------------------------- */
  const query = narrow ? { x: M, y: topY + lineH * s3 + 12 } : { x: M, y: topY + lineH * s3 + 28 };
  const gutter = clamp(W * 0.035, 32, 64);
  const gridRect: Rect = narrow
    ? { x: M, y: query.y + m.queryH + 14, w: W - M * 2, h: 0 }
    : { x: M + colW + gutter, y: topY + 6, w: 0, h: 0 };
  if (narrow) gridRect.h = Math.max(120, hud.y - 12 - gridRect.y);
  else {
    gridRect.w = W - M - gridRect.x;
    gridRect.h = H - M - gridRect.y;
  }
  const cols = narrow ? 3 : Math.min(6, groups.length);
  // Header slot: the ~22px header plus a gap, so tiles (and the 6% search bump) clear its rule.
  const grid = gridPlacement(gridRect, groups, tiles, cols, narrow ? 8 : 14, 26);
  const U = grid.tileW;

  /* Insight hero ---------------------------------------------------------- */
  let heroPose: Pose;
  let insight: { x: number; y: number };
  // On narrow screens the INSIGHT word sits top-left like the other stages, so the hero starts below it.
  const s4n = cornerWordScale(m, 4);
  if (narrow) {
    const y0 = topY + lineH * s4n + 10;
    const y1 = hud.y - 14 - m.insightH - 14;
    // Short phones get the space that is left, down to a 96px-tall frame.
    const w = Math.min(W - M * 2, Math.max(96, y1 - y0) * heroAspect);
    const h = w / heroAspect;
    heroPose = { x: W / 2, y: y0 + h / 2, w, r: 0 };
    insight = { x: M, y: y0 + h + 14 };
  } else {
    const region: Rect = { x: gridRect.x, y: topY, w: gridRect.w, h: H - topY - M };
    const w = Math.min(region.w, 780, region.h * heroAspect);
    heroPose = { x: region.x + region.w / 2, y: region.y + region.h / 2, w, r: 0 };
    // The panel sits under the giant INSIGHT word, above the caption block.
    const wordBottom = topY + lineH * insightWordScale(m);
    insight = { x: M, y: clamp(wordBottom + 24, topY + 8, Math.max(topY + 8, hud.y - m.insightH - 24)) };
  }

  /* Report sheet ------------------------------------------------------------ */
  const sheetY = narrow ? topY + lineH * s5 + 12 : Math.max(topY, Math.min((H - m.sheetH) / 2 + 8, H - M - m.sheetH));
  // Last resort on short screens: if even the narrowed sheet is taller than the room above
  // the caption block (narrow) or the screen (wide), the whole sheet is scaled down to fit.
  const sheetRoom = narrow ? hud.y - 12 - sheetY : H - M - sheetY;
  const sheetS = clamp(sheetRoom / Math.max(1, m.sheetH), 0.6, 1);
  const sheetX = narrow ? (W - m.sheetW * sheetS) / 2 : gridRect.x + (gridRect.w - m.sheetW * sheetS) / 2;
  const sheet = { x: sheetX, y: sheetY, s: sheetS };
  const action = { x: M, y: topY + lineH * s5 + 28 };

  /* Rig (giant word) --------------------------------------------------------- */
  const fit = (k: number, maxW: number, maxH: number) => fitWord(wordW, k, fontPx, maxW, maxH);
  let rig: RigPose[];
  if (narrow) {
    const mid = (topY + hud.y) / 2;
    const r0 = fit(0, W * 0.9, H * 0.2);
    const r1 = fit(1, W * 0.9, H * 0.18);
    rig = [
      { a: 1, x: W / 2, y: mid - (lineH * r0) / 2 - 8, s: r0, o: 1 },
      { a: 1, x: W / 2, y: mid - (lineH * r1) / 2, s: r1, o: 0.14 },
      { a: 0, x: M, y: topY, s: s2, o: 1 },
      { a: 0, x: M, y: topY, s: s3, o: 1 },
      { a: 0, x: M, y: topY, s: s4n, o: 1 },
      { a: 0, x: M, y: topY, s: s5, o: 1 },
    ];
  } else {
    const r0 = fit(0, W * 0.86, H * 0.34);
    const r1 = fit(1, W * 0.82, H * 0.3);
    rig = [
      { a: 1, x: W / 2, y: H * 0.47 - (lineH * r0) / 2, s: r0, o: 1 },
      { a: 1, x: W / 2, y: H * 0.5 - (lineH * r1) / 2, s: r1, o: 0.13 },
      { a: 0, x: M, y: topY, s: s2, o: 1 },
      { a: 0, x: M, y: topY, s: s3, o: 1 },
      // Giant and recessed, running under the hero photograph.
      { a: 0, x: M, y: topY, s: insightWordScale(m), o: 1 },
      { a: 0, x: M, y: topY, s: s5, o: 1 },
    ];
  }

  /* Chaos pile (seeded) ----------------------------------------------------- */
  const n = tiles.length;
  const ccols = narrow ? 3 : 6;
  const crows = Math.ceil(n / ccols);
  const cx0 = -0.05 * W;
  const cx1 = 1.05 * W;
  const cy0 = topY - 16;
  const cy1 = narrow ? hud.y - 8 : H + 12;
  const cw = (cx1 - cx0) / ccols;
  const ch = (cy1 - cy0) / crows;
  const cells = shuffle(
    Array.from({ length: ccols * crows }, (_, i) => i),
    rand,
  ).slice(0, n);

  // Flight order into the grid: column by column, top to bottom.
  const flightOrder = tiles
    .map((_, i) => i)
    .sort((a, b) => grid.col[a] - grid.col[b] || grid.poses[a].y - grid.poses[b].y);
  const flightRank: number[] = new Array(n);
  flightOrder.forEach((tileIndex, rank) => {
    flightRank[tileIndex] = rank;
  });

  const tileLayouts: TileLayout[] = tiles.map((spec, i) => {
    const aspect = spec.aspect;
    const norm = aspect < 1 ? 0.78 : aspect > 2 ? 1.28 : 1;
    const w = U * (spec.hero ? 1.32 : 0.82 + rand() * 0.9) * norm;
    const h = w / aspect;
    const cell = cells[i];
    const col = cell % ccols;
    const row = Math.floor(cell / ccols);
    let x = cx0 + (col + 0.5 + (rand() - 0.5) * 0.85) * cw;
    let y = cy0 + (row + 0.5 + (rand() - 0.5) * 0.85) * ch;
    const r = (rand() * 2 - 1) * 14;
    x = clamp(x, -w * 0.1, W + w * 0.1);
    y = clamp(y, topY - h * 0.2, H + h * 0.1);
    // Keep the caption block legible: nothing settles on it or inside its margin. Measured
    // with the rotation and the caption below the tile, at the RAW size and the larger
    // UNDERSTAND size (same centre, upright), so neither stage covers the counter.
    const undW = lerp(w, U * 1.18 * norm, 0.55);
    const capChars = spec.caption.length;
    const ext = unionExtents(tileExtents(w, aspect, r, capChars, 1), tileExtents(undW, aspect, 0, capChars, undW / w));
    const yMax = hud.y - HUD_CLEAR - ext.b;
    if (!narrow && x + ext.r > hud.x - HUD_CLEAR && x + ext.l < hud.x + hud.w + HUD_CLEAR) {
      // Wide layouts: the pile above the caption column is compressed rather than cut off,
      // so tiles keep their scatter instead of lining up (captions overlapping) on its edge.
      const lo = topY - h * 0.2;
      const hi = H + h * 0.1;
      if (yMax > lo) y = lo + ((y - lo) * (yMax - lo)) / (hi - lo);
    }
    if (overHud(x, y, ext, hud)) y = yMax;
    if (spec.hero) {
      x = clamp(x, W * 0.3, W * 0.7);
      y = clamp(y, Math.max(topY + h / 2, H * 0.32), Math.min(H * 0.6, hud.y - HUD_CLEAR - ext.b));
    }
    const chaos: Pose = { x, y, w, r };

    const dx = x - W / 2;
    const dy = y - H / 2;
    const len = Math.hypot(dx, dy) || 1;
    const dist = Math.max(W, H) * (0.4 + rand() * 0.25);
    let entry: Pose = { x: x + (dx / len) * dist, y: y + (dy / len) * dist, w: w * 1.06, r: r + (rand() - 0.5) * 26 };
    // The drift in must not sweep across the caption block either (checked once the tile is
    // 20% opaque): such tiles come in sideways at their resting height, which is clear of it,
    // or failing that from above.
    if (pathCrossesHud(entry, chaos, aspect, capChars, w, hud, 0.2)) {
      entry = { ...entry, x: x + (x < W / 2 ? -dist : dist), y };
      if (pathCrossesHud(entry, chaos, aspect, capChars, w, hud, 0.2)) entry = { ...entry, x, y: y - dist };
    }
    const und: Pose = { x, y, w: undW, r: 0 };
    const gridPose = grid.poses[i];
    // Captions are fading out as the flight starts, so they are included in the check.
    const detour = pathCrossesHud(und, gridPose, aspect, capChars, w, hud);
    const delay = spec.hero ? 0.092 : 0.026 + rand() * 0.062;
    const spin = (rand() * 2 - 1) * 5;

    let bw = Math.max(entry.w, chaos.w, und.w, gridPose.w * 1.06);
    if (spec.hero) bw = Math.max(bw, heroPose.w, m.slot.w * sheetS);
    return {
      bw,
      bh: bw / aspect,
      aspect,
      entry,
      chaos,
      und,
      grid: gridPose,
      delay,
      flight: 0.335 + 0.055 * (flightRank[i] / Math.max(1, n - 1)),
      spin,
      detour,
      capFs: (9 * bw) / chaos.w,
      chipFs: (7.5 * bw) / und.w,
      bd: bw / und.w,
      ring: (1.5 * bw) / (gridPose.w * 1.06),
      // Nominal size once the INSIGHT frame is at least 200px wide; proportionally smaller on
      // tinier frames (short phones), so the labels still fit inside it.
      annK: spec.hero ? (bw / heroPose.w) * Math.min(1, heroPose.w / 200) : 1,
      hero: spec.hero,
      match: spec.match,
      primary: spec.primary,
    };
  });

  return {
    W,
    H,
    narrow,
    tiles: tileLayouts,
    headers: grid.headers,
    heroPose,
    recede: { x: gridRect.x + gridRect.w / 2, y: gridRect.y + gridRect.h / 2 },
    rig,
    query,
    insight,
    action,
    sheet,
    // Wide layouts: the sheet rises from below the screen, beside the caption block. Narrow
    // layouts stack it directly above the caption block, so it only lifts a little as it
    // fades in and never passes behind the caption text.
    sheetRise: narrow ? Math.min(H * 0.55, 32) : H * 0.55,
    slot: { cx: (m.slot.x + m.slot.w / 2) * sheetS, cy: (m.slot.y + m.slot.h / 2) * sheetS, w: m.slot.w * sheetS },
    scanFrom: topY - 24,
    scanTo: H + 8,
  };
}
