import type { MediaAsset } from '@/lib/types';
import { SEVERITY_RANK } from '@/lib/analytics';

/**
 * Editorial mosaic for the Library.
 *
 * Tile size carries meaning: critical and high findings become feature tiles,
 * video and panoramic frames run wide, portrait frames run tall, everything
 * else is a standard cell. This module decides spans, runs the dense placement
 * algorithm (CSS `grid-auto-flow: row dense`) to close holes before they
 * render, and returns every tile's cell. The grid places tiles explicitly at
 * those cells and renders them in reading order (row, then column), so DOM
 * order — Tab order, screen-reader order, the Inspector's ← / → sequence —
 * is exactly the visual order. Plain dense auto-flow would backfill later
 * tiles into earlier holes, so the DOM would jump down and back up.
 */

export type TileKind = 'standard' | 'wide' | 'tall' | 'feature';

export const TILE_SPAN: Record<TileKind, { cols: number; rows: number }> = {
  standard: { cols: 1, rows: 1 },
  wide: { cols: 2, rows: 1 },
  tall: { cols: 1, rows: 2 },
  feature: { cols: 2, rows: 2 },
};

/** Row height as a fraction of the column width (standard tiles ≈ 25:18). */
export const ROW_RATIO = 0.72;
export const GRID_GAP = 8;
/** Minimum comfortable column width before the grid drops a column. */
const MIN_COLUMN = 250;

/** Width ÷ height of each tile kind, used to ask Cloudinary for a matching g_auto crop. */
export const TILE_ASPECT: Record<TileKind, number> = {
  standard: 1 / ROW_RATIO,
  feature: 1 / ROW_RATIO,
  wide: 2 / ROW_RATIO,
  tall: 1 / (2 * ROW_RATIO),
};

export function columnsFor(width: number): number {
  return Math.max(2, Math.min(6, Math.floor((width + GRID_GAP) / (MIN_COLUMN + GRID_GAP))));
}

function preferredKind(asset: MediaAsset): TileKind {
  if (asset.resourceType === 'video') return 'wide';
  const ratio = asset.width / Math.max(1, asset.height);
  if (ratio >= 2.2) return 'wide';
  if (ratio <= 0.8) return 'tall';
  return 'standard';
}

/** Spans before hole-filling: consequence first, then the frame's own shape. */
function assignKinds(assets: MediaAsset[]): TileKind[] {
  const kinds = assets.map(preferredKind);
  // Feature tiles stay rare so they keep their meaning in large libraries.
  const budget = Math.max(1, Math.floor(assets.length / 6));
  assets
    .map((asset, index) => ({ asset, index }))
    .filter(({ asset }) => asset.finding?.severity === 'critical' || asset.finding?.severity === 'high')
    .sort((a, b) => SEVERITY_RANK[b.asset.finding!.severity] - SEVERITY_RANK[a.asset.finding!.severity] || a.index - b.index)
    .forEach(({ index }, rank) => {
      kinds[index] = rank < budget ? 'feature' : 'wide';
    });
  return kinds;
}

/** A tile's placement: zero-based top-left cell and its span, in grid tracks. */
export interface TileCell {
  row: number;
  col: number;
  rows: number;
  cols: number;
}

export interface MosaicPlan {
  /** Tile kind per input asset (same order as the input). */
  kinds: TileKind[];
  /** Placement per input asset (same order as the input). */
  cells: TileCell[];
  /** Input indices in reading order: by row, then column. */
  order: number[];
}

interface Simulation {
  holes: number;
  rows: number;
}

/**
 * CSS `grid-auto-flow: row dense` for auto-placed items, cell by cell.
 * Pass `cells` to record where each item lands (the final pass only; the
 * planner's trials skip it).
 */
function simulate(kinds: TileKind[], cols: number, cells?: TileCell[]): Simulation {
  const grid: boolean[][] = [];
  const taken = (r: number, c: number) => grid[r]?.[c] === true;
  let rows = 0;
  let firstOpenRow = 0;
  for (const kind of kinds) {
    const w = Math.min(TILE_SPAN[kind].cols, cols);
    const h = TILE_SPAN[kind].rows;
    let placed = false;
    for (let r = firstOpenRow; !placed; r++) {
      for (let c = 0; c + w <= cols && !placed; c++) {
        let fits = true;
        for (let dr = 0; dr < h && fits; dr++) {
          for (let dc = 0; dc < w; dc++) {
            if (taken(r + dr, c + dc)) {
              fits = false;
              break;
            }
          }
        }
        if (!fits) continue;
        for (let dr = 0; dr < h; dr++) {
          const row = (grid[r + dr] ??= new Array<boolean>(cols).fill(false));
          for (let dc = 0; dc < w; dc++) row[c + dc] = true;
        }
        rows = Math.max(rows, r + h);
        cells?.push({ row: r, col: c, rows: h, cols: w });
        placed = true;
      }
    }
    while (firstOpenRow < rows && grid[firstOpenRow]?.every(Boolean)) firstOpenRow++;
  }
  let holes = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) if (!taken(r, c)) holes++;
  }
  return { holes, rows };
}

/** Alternative spans a tile may take to close a hole, most natural first. */
function alternatives(kind: TileKind, asset: MediaAsset): TileKind[] {
  const ratio = asset.width / Math.max(1, asset.height);
  // Low-resolution frames never grow: an upscaled crop would only look worse.
  const lowRes = asset.width < 400 || asset.height < 240;
  switch (kind) {
    case 'standard':
      if (lowRes) return [];
      return ratio >= 1 ? ['wide', 'tall'] : ['tall', 'wide'];
    case 'tall':
    case 'wide':
      return ['standard'];
    default:
      return [];
  }
}

type Change = { index: number; kind: TileKind };

function better(result: Simulation, than: Simulation): boolean {
  return result.holes < than.holes || (result.holes === than.holes && result.rows < than.rows);
}

/**
 * Tile kinds for `assets` in a grid of `cols` columns, adjusted so the
 * mosaic closes into a clean rectangle whenever a small change allows it,
 * plus each tile's cell and the reading order.
 */
export function planMosaic(assets: MediaAsset[], cols: number): MosaicPlan {
  const kinds = adjustKinds(assets, cols);
  const cells: TileCell[] = [];
  simulate(kinds, cols, cells);
  const order = cells.map((_, i) => i).sort((a, b) => cells[a].row - cells[b].row || cells[a].col - cells[b].col);
  return { kinds, cells, order };
}

function adjustKinds(assets: MediaAsset[], cols: number): TileKind[] {
  const kinds = assignKinds(assets);
  if (assets.length < 3) return kinds;
  let best = simulate(kinds, cols);
  const touched = new Set<number>();

  // Adjustable tiles, nearest the end first so the top of the grid stays stable.
  const candidates = () => {
    const out: number[] = [];
    for (let i = kinds.length - 1; i >= 0 && out.length < 18; i--) {
      if (!touched.has(i) && alternatives(kinds[i], assets[i]).length) out.push(i);
    }
    return out;
  };
  const trial = (changes: Change[]) => {
    const next = kinds.slice();
    for (const c of changes) next[c.index] = c.kind;
    return simulate(next, cols);
  };

  for (let pass = 0; pass < 8 && best.holes > 0; pass++) {
    const pool = candidates();
    let choice: { changes: Change[]; result: Simulation } | null = null;
    for (const i of pool) {
      for (const kind of alternatives(kinds[i], assets[i])) {
        const changes = [{ index: i, kind }];
        const result = trial(changes);
        if (result.holes < best.holes && (!choice || better(result, choice.result))) choice = { changes, result };
      }
    }
    // No single change helps: try pairs among the nearest candidates.
    if (!choice) {
      const near = pool.slice(0, 10);
      for (let a = 0; a < near.length; a++) {
        for (let b = a + 1; b < near.length; b++) {
          for (const ka of alternatives(kinds[near[a]], assets[near[a]])) {
            for (const kb of alternatives(kinds[near[b]], assets[near[b]])) {
              const changes = [
                { index: near[a], kind: ka },
                { index: near[b], kind: kb },
              ];
              const result = trial(changes);
              if (result.holes < best.holes && (!choice || better(result, choice.result))) choice = { changes, result };
            }
          }
        }
      }
    }
    if (!choice) break;
    for (const c of choice.changes) {
      kinds[c.index] = c.kind;
      touched.add(c.index);
    }
    best = choice.result;
  }
  return kinds;
}
