/**
 * Instance data for the hero's visual-data field.
 *
 * Every fragment is a small window into one tile of the Cloudinary atlas. It
 * has a "chaos" state (scattered through a shallow 3D volume, varied size and
 * aspect) and an "order" state (a cell in one of three loose grid blocks).
 * The vertex shader blends between the two as the hero scrolls away, so raw
 * visual data visibly settles into structure.
 *
 * Deterministic: a seeded PRNG composes the same field on every visit.
 */

/** Floats per instance: chaos (4) · order (4) · atlas window (4) · meta (4). */
export const FLOATS_PER_INSTANCE = 16;

/**
 * Cluster anchors in screen-normalised space: x −1 (left) … 1 (right),
 * y −1 (top) … 1 (bottom). On wide layouts the blocks settle into the band
 * between the hero content and its proof rail, so they read clearly while the
 * copy fades; on tall layouts they settle mid-frame. Slight offsets keep them
 * organised rather than mechanical.
 */
function clusterAnchors(wide: boolean): ReadonlyArray<readonly [number, number]> {
  return wide
    ? [
        [-0.62, 0.36],
        [0.0, 0.31],
        [0.62, 0.38],
      ]
    : [
        [-0.6, 0.14],
        [0.0, 0.06],
        [0.6, 0.18],
      ];
}

/** Width / height of each organised block, in cells. */
const BLOCK_ASPECT = 2.4;

/** Quad aspect ratios (height / width): mostly frames, some squares. */
const ASPECTS = [1, 0.5625, 0.75, 1, 0.5625, 1.3333];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Shard {
  x: number;
  y: number;
  z: number;
  w: number;
  aspect: number;
  kind: number;
  tone: number;
  seed: number;
  u0: number;
  v0: number;
  du: number;
  dv: number;
  cluster: number;
  gx: number;
  gy: number;
}

export function buildFieldInstances({
  count,
  cols,
  rows,
  viewAspect = 1.6,
  seed = 20260926,
}: {
  count: number;
  /** Atlas grid (tiles per row / column). */
  cols: number;
  rows: number;
  /** Canvas width / height when built: decides where the field is densest. */
  viewAspect?: number;
  seed?: number;
}): Float32Array {
  const rand = mulberry32(seed);
  const shards: Shard[] = [];

  // Density is a volume, not wallpaper: concentrated behind the product (right
  // of centre on wide screens, lower half on tall ones), thinning toward the type.
  const wide = viewAspect >= 1.1;
  const fx = wide ? 0.36 : 0;
  const fy = wide ? 0 : 0.36;
  const sx = wide ? 0.6 : 0.95;
  const sy = wide ? 0.78 : 0.55;
  const density = (x: number, y: number) =>
    0.14 + 0.86 * Math.exp(-((x - fx) ** 2 / (2 * sx * sx) + (y - fy) ** 2 / (2 * sy * sy)));

  for (let i = 0; i < count; i += 1) {
    let x = 0;
    let y = 0;
    do {
      x = rand() * 2.3 - 1.15;
      y = rand() * 2.3 - 1.15;
    } while (rand() > density(x, y));
    // Skewed toward the back: many small, fogged shards; few large, near ones.
    const z = Math.pow(rand(), 0.62);
    let w = (24 - 17 * z) * (0.72 + rand() * 0.56);
    if (rand() < 0.04) w *= 1.55;
    w = Math.max(6, Math.min(42, w));
    const aspect = ASPECTS[Math.floor(rand() * ASPECTS.length)];
    // A few are empty detection boxes (hairline outlines) instead of image shards.
    const kind = rand() < 0.035 ? 1 : 0;
    const tone = 0.8 + rand() * 0.28;

    // A window inside one atlas tile: small shards sample detail, larger ones context.
    const tile = Math.floor(rand() * cols * rows);
    const tc = tile % cols;
    const tr = Math.floor(tile / cols);
    const fw = w < 13 ? 0.14 + rand() * 0.16 : 0.24 + rand() * 0.32;
    const fh = Math.min(0.9, fw * aspect);
    const margin = 0.04;
    const ox = margin + rand() * Math.max(0, 1 - 2 * margin - fw);
    const oy = margin + rand() * Math.max(0, 1 - 2 * margin - fh);

    shards.push({
      x,
      y,
      z,
      w,
      aspect,
      kind,
      tone,
      seed: rand(),
      u0: (tc + ox) / cols,
      v0: (tr + oy) / rows,
      du: fw / cols,
      dv: fh / rows,
      cluster: 0,
      gx: 0,
      gy: 0,
    });
  }

  // Order state: split left → right into three groups, then lay each group out
  // as a grid, filling rows top → bottom and cells left → right. Mapping by
  // position keeps paths short, so convergence reads as settling, not shuffling.
  const anchors = clusterAnchors(wide);
  const byX = shards.map((_, i) => i).sort((a, b) => shards[a].x - shards[b].x);
  const perCluster = Math.ceil(count / anchors.length);
  for (let c = 0; c < anchors.length; c += 1) {
    const members = byX.slice(c * perCluster, (c + 1) * perCluster);
    if (!members.length) continue;
    const gridCols = Math.max(1, Math.ceil(Math.sqrt(members.length * BLOCK_ASPECT)));
    const gridRows = Math.ceil(members.length / gridCols);
    members.sort((a, b) => shards[a].y - shards[b].y);
    for (let r = 0; r < gridRows; r += 1) {
      const row = members.slice(r * gridCols, (r + 1) * gridCols).sort((a, b) => shards[a].x - shards[b].x);
      const inset = (gridCols - row.length) / 2;
      row.forEach((index, col) => {
        const s = shards[index];
        s.cluster = c;
        // Loose, not rigid: a little jitter survives into the organised state.
        s.gx = col + inset - (gridCols - 1) / 2 + (rand() - 0.5) * 0.22;
        s.gy = r - (gridRows - 1) / 2 + (rand() - 0.5) * 0.22;
      });
    }
  }

  // Far → near, so alpha blending composites back to front.
  shards.sort((a, b) => b.z - a.z);

  const data = new Float32Array(count * FLOATS_PER_INSTANCE);
  shards.forEach((s, i) => {
    const [cx, cy] = anchors[s.cluster];
    data.set(
      [s.x, s.y, s.z, s.w, cx, cy, s.gx, s.gy, s.u0, s.v0, s.du, s.dv, s.seed, s.aspect, s.kind, s.tone],
      i * FLOATS_PER_INSTANCE,
    );
  });
  return data;
}
