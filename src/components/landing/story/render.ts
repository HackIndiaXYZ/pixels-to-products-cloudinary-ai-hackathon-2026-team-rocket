import { clamp, easeInOutCubic, easeOutCubic, lerp, progressBetween } from '@/components/motion/hooks';
import { BOUNDS, STORY_QUERY, WORD_STYLES } from './data';
import type { Pose, RigPose, SceneLayout } from './layout';

/**
 * Per-frame renderer for the platform story.
 *
 * Called from a framer-motion value subscription (already rAF-batched). It
 * performs no layout reads, touches only transform / opacity (plus the one
 * kinetic word's font axes on capable devices) and skips any write whose
 * value has not changed since the previous frame.
 *
 * Writes that make the browser repaint rather than just composite are
 * quantised so they change on a few dozen frames per stage, not on every
 * frame: the kinetic word's axes (re-shapes and re-rasterises a ~300px word)
 * and the tile overlays and captions (repaint each tile's layer). Overlays
 * get their opacity written on their own node, never through a custom
 * property on the tile, which would re-style the tile's whole subtree.
 */

type El = HTMLElement | null;

export interface SceneDom {
  stage: El;
  rig: El;
  words: El[];
  tilesLayer: El;
  tiles: El[];
  /** Per tile (index-aligned with `tiles`): Cloudinary-signal overlay, search-hit ring, INSIGHT annotation. */
  tileAi: El[];
  tileHit: El[];
  tileAnn: El[];
  hud: El;
  hudBlocks: El[];
  counter: El;
  segs: El[];
  scan: El;
  gridBg: El;
  headers: El;
  headerItems: El[];
  record: El;
  query: El;
  typed: El;
  rich: El;
  caret: El;
  underlines: El[];
  chips: El;
  result: El;
  insight: El;
  action: El;
  sheet: El;
  slot: El;
  evidence: El;
  hash: El;
  evidenceReady: boolean;
  typedCount: number;
}

export function createSceneDom(): SceneDom {
  return {
    stage: null,
    rig: null,
    words: [],
    tilesLayer: null,
    tiles: [],
    tileAi: [],
    tileHit: [],
    tileAnn: [],
    hud: null,
    hudBlocks: [],
    counter: null,
    segs: [],
    scan: null,
    gridBg: null,
    headers: null,
    headerItems: [],
    record: null,
    query: null,
    typed: null,
    rich: null,
    caret: null,
    underlines: [],
    chips: null,
    result: null,
    insight: null,
    action: null,
    sheet: null,
    slot: null,
    evidence: null,
    hash: null,
    evidenceReady: false,
    typedCount: -1,
  };
}

/**
 * Finds the scene's animated elements by their `data-sc` markers (document
 * order = index order). Runs in an effect after commit, never during render.
 */
export function collectSceneDom(dom: SceneDom, root: HTMLElement): void {
  const one = (name: string) => root.querySelector<HTMLElement>(`[data-sc="${name}"]`);
  const all = (name: string) => Array.from(root.querySelectorAll<HTMLElement>(`[data-sc="${name}"]`));
  dom.stage = root;
  dom.rig = one('rig');
  dom.words = all('word');
  dom.tilesLayer = one('tiles');
  dom.tiles = all('tile');
  const inTile = (tile: El, name: string) => tile?.querySelector<HTMLElement>(`[data-sc="${name}"]`) ?? null;
  dom.tileAi = dom.tiles.map((t) => inTile(t, 'ai'));
  dom.tileHit = dom.tiles.map((t) => inTile(t, 'hit'));
  dom.tileAnn = dom.tiles.map((t) => inTile(t, 'ann'));
  dom.hud = one('hud');
  dom.hudBlocks = all('block');
  dom.counter = one('counter');
  dom.segs = all('seg');
  dom.scan = one('scan');
  dom.gridBg = one('grid-bg');
  dom.headers = one('headers');
  dom.headerItems = all('header');
  dom.record = one('record');
  dom.query = one('query');
  dom.typed = one('typed');
  dom.rich = one('rich');
  dom.caret = one('caret');
  dom.underlines = all('underline');
  dom.chips = one('chips');
  dom.result = one('result');
  dom.insight = one('insight');
  dom.action = one('action');
  dom.sheet = one('sheet');
  dom.slot = one('slot');
  dom.evidence = one('evidence');
  dom.hash = one('hash');
  dom.typedCount = -1;
}

/* ------------------------------------------------------------------------ */
/* Write cache                                                               */
/* ------------------------------------------------------------------------ */

const written = new WeakMap<HTMLElement, Record<string, string>>();

/** Sets a style property (kebab-case or custom property) only when it changed. */
export function put(el: HTMLElement | null | undefined, prop: string, value: string): void {
  if (!el) return;
  let rec = written.get(el);
  if (!rec) {
    rec = {};
    written.set(el, rec);
  }
  if (rec[prop] === value) return;
  rec[prop] = value;
  el.style.setProperty(prop, value);
}

const f1 = (v: number) => v.toFixed(1);
const f3 = (v: number) => v.toFixed(3);

/** Opacity plus visibility (so fully faded layers are skipped by paint and hit-testing). */
function fade(el: HTMLElement | null, o: number): void {
  const v = clamp(o);
  put(el, 'opacity', f3(v));
  put(el, 'visibility', v < 0.004 ? 'hidden' : 'visible');
}

/** Opacity only — for parts inside a layer whose own visibility is managed by `fade`. */
function tint(el: HTMLElement | null, o: number): void {
  put(el, 'opacity', f3(clamp(o)));
}

/** Steps for opacities that repaint a tile layer when they change. */
const PAINT_STEPS = 24;
const step = (v: number) => Math.round(clamp(v) * PAINT_STEPS) / PAINT_STEPS;

/**
 * Quantised opacity + visibility for an overlay inside a tile: it changes at most
 * PAINT_STEPS times per fade, and is skipped by paint entirely while at 0.
 */
function overlay(el: HTMLElement | null, o: number): void {
  if (!el) return;
  const v = step(o);
  put(el, 'opacity', f3(v));
  put(el, 'visibility', v === 0 ? 'hidden' : 'visible');
}

/** Kinetic word axes, quantised: width in 4-unit steps, weight in 20s, tracking in 0.005em. */
const AXIS_WDTH = 4;
const AXIS_WGHT = 20;
const AXIS_TRACK = 0.005;
const quant = (v: number, q: number) => Math.round(v / q) * q;

/* ------------------------------------------------------------------------ */
/* Timeline helpers                                                          */
/* ------------------------------------------------------------------------ */

const B = BOUNDS;
const STAGE_COUNT = BOUNDS.length - 1;
const ramp = progressBetween;
const io = (v: number, a: number, b: number) => easeInOutCubic(progressBetween(v, a, b));
const out = (v: number, a: number, b: number) => easeOutCubic(progressBetween(v, a, b));

function mixPose(a: Pose, b: Pose, t: number): Pose {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), r: lerp(a.r, b.r, t) };
}

function mixRig(a: RigPose, b: RigPose, t: number): RigPose {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), s: lerp(a.s, b.s, t), a: lerp(a.a, b.a, t), o: lerp(a.o, b.o, t) };
}

/** Stage index for a progress value. */
export function stageAt(p: number): number {
  for (let k = B.length - 2; k >= 0; k--) if (p >= B[k]) return k;
  return 0;
}

/** The word rig inside stage k (with small in-stage drifts). */
function rigInStage(L: SceneLayout, k: number, p: number): RigPose {
  const base = L.rig[k];
  const q = ramp(p, B[k], B[k + 1]);
  if (k === 0) {
    // Negative space first; the word steps back as the media arrives.
    return { ...base, s: base.s * (1 + 0.035 * q), o: 1 - 0.8 * ramp(p, 0.05, 0.125) };
  }
  if (k === 4) return { ...base, s: base.s * (0.97 + 0.03 * q) };
  return base;
}

const RIG_BEFORE = 0.03;
const RIG_AFTER = 0.045;

function rigAt(L: SceneLayout, p: number): RigPose {
  for (let j = 1; j < B.length - 1; j++) {
    const b = B[j];
    if (p >= b - RIG_BEFORE && p <= b + RIG_AFTER) {
      const from = rigInStage(L, j - 1, b - RIG_BEFORE);
      const to = rigInStage(L, j, b + RIG_AFTER);
      return mixRig(from, to, io(p, b - RIG_BEFORE, b + RIG_AFTER));
    }
  }
  return rigInStage(L, stageAt(p), p);
}

/* ------------------------------------------------------------------------ */
/* Static writes (on layout)                                                 */
/* ------------------------------------------------------------------------ */

export function applyLayout(dom: SceneDom, L: SceneLayout, kinetic: boolean): void {
  L.tiles.forEach((t, i) => {
    const el = dom.tiles[i];
    if (!el) return;
    put(el, 'width', `${f1(t.bw)}px`);
    put(el, 'height', `${f1(t.bh)}px`);
    put(el, '--cap-fs', `${f1(t.capFs)}px`);
    put(el, '--chip-fs', `${f1(t.chipFs)}px`);
    put(el, '--bd', `${t.bd.toFixed(2)}px`);
    put(el, '--ring', `${t.ring.toFixed(2)}px`);
    if (t.hero) put(el, '--ann-k', t.annK.toFixed(3));
  });
  L.headers.forEach((h, i) => {
    const el = dom.headerItems[i];
    put(el, 'transform', `translate3d(${f1(h.x)}px, ${f1(h.y)}px, 0)`);
    put(el, 'width', `${f1(h.w)}px`);
  });
  if (!kinetic) {
    // Static typography per stage on low-tier devices: no per-frame font work.
    WORD_STYLES.forEach((s, k) => {
      const el = dom.words[k];
      put(el, 'font-variation-settings', `"wdth" ${lerp(s.wdth[0], s.wdth[1], 0.5).toFixed(0)}, "wght" ${Math.max(...s.wght)}`);
      put(el, 'letter-spacing', `${lerp(s.track[0], s.track[1], 0.5).toFixed(3)}em`);
    });
  }
}

/* ------------------------------------------------------------------------ */
/* Per-frame                                                                 */
/* ------------------------------------------------------------------------ */

const SWAP_BEFORE = 0.012;
const SWAP_AFTER = 0.016;

export function drawScene(dom: SceneDom, L: SceneLayout, pIn: number, kinetic: boolean): void {
  const p = clamp(pIn);

  /* Shared timeline values ------------------------------------------------ */
  const scanT = ramp(p, 0.2, 0.3);
  const scanY = lerp(L.scanFrom, L.scanTo, scanT);
  const aiOut = 1 - ramp(p, 0.335, 0.37);
  const searchF = io(p, 0.585, 0.612);
  const hitOn = searchF * (1 - ramp(p, 0.665, 0.69));
  const insK = io(p, 0.665, 0.735);
  const recK = io(p, 0.665, 0.71);
  const actK = io(p, 0.845, 0.91);
  const sheetRise = out(p, 0.835, 0.9);
  const sheetDy = (1 - sheetRise) * L.sheetRise;
  const ann = ramp(p, 0.72, 0.75) * (1 - ramp(p, 0.835, 0.855));

  /* Tiles --------------------------------------------------------------- */
  put(dom.tilesLayer, '--cap', f3(step(1 - ramp(p, 0.335, 0.37))));
  for (let i = 0; i < L.tiles.length; i++) {
    const t = L.tiles[i];
    const el = dom.tiles[i];
    if (!el) continue;
    let pose: Pose;
    let o = 1;
    if (p < B[1]) {
      const k = out(p, t.delay, t.delay + 0.05);
      pose = mixPose(t.entry, t.chaos, k);
      o = k;
    } else if (p < B[2]) {
      pose = mixPose(t.chaos, t.und, io(p, 0.165, 0.228));
    } else if (p < B[3]) {
      const k = io(p, t.flight, t.flight + 0.07);
      pose = mixPose(t.und, t.grid, k);
      if (t.detour) {
        // Across first, then down into the column, around the caption block.
        pose.x = lerp(t.und.x, t.grid.x, io(p, t.flight, t.flight + 0.045));
        pose.y = lerp(t.und.y, t.grid.y, io(p, t.flight + 0.025, t.flight + 0.07));
      }
      const arc = Math.sin(Math.PI * k);
      pose.y -= arc * 22;
      pose.r += arc * t.spin;
    } else {
      const gridW = t.grid.w * (t.match ? 1 + 0.06 * searchF : 1);
      const oSearch = t.match ? 1 : 1 - 0.85 * searchF;
      const searched: Pose = { x: t.grid.x, y: t.grid.y, w: gridW, r: 0 };
      if (p < B[4]) {
        pose = searched;
        o = oSearch;
      } else if (t.hero) {
        if (p < B[5]) {
          pose = mixPose(searched, L.heroPose, insK);
        } else {
          const slot: Pose = { x: L.sheet.x + L.slot.cx, y: L.sheet.y + L.slot.cy + sheetDy, w: L.slot.w, r: 0 };
          pose = mixPose(L.heroPose, slot, actK);
          // Hand over to the stamped Cloudinary frame once it has arrived.
          o = dom.evidenceReady ? 1 - ramp(p, 0.915, 0.94) : 1;
        }
      } else {
        const recX = L.recede.x + (t.grid.x - L.recede.x) * 0.92;
        const recY = L.recede.y + (t.grid.y - L.recede.y) * 0.92;
        pose = { x: lerp(t.grid.x, recX, recK), y: lerp(t.grid.y, recY, recK), w: gridW * lerp(1, 0.92, recK), r: 0 };
        o = lerp(oSearch, 0.05, recK) * (p < B[5] ? 1 : 1 - ramp(p, 0.83, 0.86));
      }
    }
    put(
      el,
      'transform',
      `translate3d(${f1(pose.x - t.bw / 2)}px, ${f1(pose.y - t.bh / 2)}px, 0) rotate(${pose.r.toFixed(2)}deg) scale(${(pose.w / t.bw).toFixed(4)})`,
    );
    fade(el, o);
    if (t.primary) {
      const undH = t.und.w / t.aspect;
      const seen = scanT > 0 ? ramp(scanY, t.und.y - undH * 0.5, t.und.y + undH * 0.15) : 0;
      overlay(dom.tileAi[i], seen * aiOut);
    }
    if (t.match) overlay(dom.tileHit[i], hitOn);
    if (t.hero) overlay(dom.tileAnn[i], ann);
  }

  /* Environment ------------------------------------------------------------ */
  put(dom.scan, 'transform', `translate3d(0, ${f1(scanY)}px, 0)`);
  fade(dom.scan, ramp(p, 0.195, 0.205) * (1 - ramp(p, 0.295, 0.305)));
  fade(dom.gridBg, 0.55 * ramp(p, 0.36, 0.44) * (1 - ramp(p, 0.665, 0.7)));
  fade(dom.headers, ramp(p, 0.43, 0.47) * (1 - ramp(p, 0.662, 0.68)));

  /* Giant stage word --------------------------------------------------------- */
  const rig = rigAt(L, p);
  put(dom.rig, 'transform', `translate3d(${f1(rig.x)}px, ${f1(rig.y)}px, 0) scale(${rig.s.toFixed(4)})`);
  fade(dom.rig, rig.o);
  for (let j = 0; j < WORD_STYLES.length; j++) {
    const el = dom.words[j];
    if (!el) continue;
    const enter = j === 0 ? 1 : io(p, B[j] - SWAP_BEFORE, B[j] + SWAP_AFTER);
    const exit = j === WORD_STYLES.length - 1 ? 0 : io(p, B[j + 1] - SWAP_BEFORE, B[j + 1] + SWAP_AFTER);
    const y = (1 - enter) * 110 - exit * 110;
    const visible = enter > 0 && exit < 1;
    put(el, 'transform', `translate3d(${(-50 * rig.a).toFixed(2)}%, ${y.toFixed(2)}%, 0)`);
    put(el, 'visibility', visible ? 'visible' : 'hidden');
    if (kinetic && visible) {
      const s = WORD_STYLES[j];
      const q = easeInOutCubic(ramp(p, B[j], B[j + 1]));
      const wdth = quant(lerp(s.wdth[0], s.wdth[1], q), AXIS_WDTH);
      const wght = quant(lerp(s.wght[0], s.wght[1], q), AXIS_WGHT);
      put(el, 'font-variation-settings', `"wdth" ${wdth}, "wght" ${wght}`);
      put(el, 'letter-spacing', `${quant(lerp(s.track[0], s.track[1], q), AXIS_TRACK).toFixed(3)}em`);
    }
  }

  /* Caption block --------------------------------------------------------- */
  let stageFloat = 0;
  for (let k = 0; k < STAGE_COUNT; k++) {
    const block = dom.hudBlocks[k];
    const inn = k === 0 ? 1 : ramp(p, B[k] + 0.002, B[k] + 0.016);
    const gone = k === STAGE_COUNT - 1 ? 0 : ramp(p, B[k + 1] - 0.016, B[k + 1] - 0.002);
    fade(block, inn * (1 - gone));
    put(block, 'transform', `translate3d(0, ${f1((1 - inn) * 10 - gone * 10)}px, 0)`);
    if (k > 0) stageFloat += io(p, B[k] - SWAP_BEFORE, B[k] + SWAP_AFTER);
    put(dom.segs[k], 'transform', `scaleX(${f3(ramp(p, B[k], B[k + 1]))})`);
  }
  put(dom.counter, 'transform', `translate3d(0, ${((-stageFloat / STAGE_COUNT) * 100).toFixed(3)}%, 0)`);

  /* Structure: one capture as its record (wide layouts, left column) ------------ */
  const recIn = L.narrow ? 0 : ramp(p, 0.4, 0.44);
  const recOut = ramp(p, 0.49, 0.503);
  fade(dom.record, recIn * (1 - recOut));
  put(dom.record, 'transform', `translate3d(${f1(L.query.x)}px, ${f1(L.query.y + (1 - recIn) * 12 - recOut * 10)}px, 0)`);

  /* Search ---------------------------------------------------------------- */
  const qIn = ramp(p, 0.505, 0.52);
  const qOut = ramp(p, 0.655, 0.672);
  fade(dom.query, qIn * (1 - qOut));
  put(dom.query, 'transform', `translate3d(${f1(L.query.x)}px, ${f1(L.query.y + (1 - qIn) * 14 - qOut * 10)}px, 0)`);
  const len = STORY_QUERY.length;
  const n = Math.round(len * ramp(p, 0.522, 0.575));
  if (n !== dom.typedCount && dom.typed) {
    dom.typedCount = n;
    dom.typed.textContent = STORY_QUERY.slice(0, n);
  }
  put(dom.typed, 'display', n < len ? 'inline' : 'none');
  put(dom.rich, 'display', n < len ? 'none' : 'inline');
  put(dom.caret, 'opacity', qIn > 0.5 && n < len ? '1' : '0');
  const underline = out(p, 0.578, 0.594);
  for (const u of dom.underlines) put(u, 'transform', `scaleX(${f3(underline)})`);
  const chips = ramp(p, 0.576, 0.595);
  tint(dom.chips, chips);
  put(dom.chips, 'transform', `translate3d(0, ${f1((1 - chips) * 6)}px, 0)`);
  tint(dom.result, ramp(p, 0.595, 0.612));

  /* Insight --------------------------------------------------------------- */
  const iIn = ramp(p, 0.72, 0.755);
  const iOut = ramp(p, 0.825, 0.842);
  fade(dom.insight, iIn * (1 - iOut));
  put(dom.insight, 'transform', `translate3d(${f1(L.insight.x)}px, ${f1(L.insight.y + (1 - iIn) * 14)}px, 0)`);

  /* Action ---------------------------------------------------------------- */
  put(dom.sheet, 'transform', `translate3d(${f1(L.sheet.x)}px, ${f1(L.sheet.y + sheetDy)}px, 0) scale(${L.sheet.s.toFixed(4)})`);
  fade(dom.sheet, ramp(p, 0.835, 0.862));
  tint(dom.evidence, dom.evidenceReady ? ramp(p, 0.905, 0.93) : 0);
  tint(dom.hash, ramp(p, 0.935, 0.955));
  const aIn = L.narrow ? 0 : ramp(p, 0.9, 0.93);
  fade(dom.action, aIn);
  put(dom.action, 'transform', `translate3d(${f1(L.action.x)}px, ${f1(L.action.y + (1 - aIn) * 12)}px, 0)`);
  put(dom.action, 'pointer-events', aIn > 0.6 ? 'auto' : 'none');
}
