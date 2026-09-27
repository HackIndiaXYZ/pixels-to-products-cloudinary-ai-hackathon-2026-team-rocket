#!/usr/bin/env node
/**
 * Verifies the VisualOps ⇄ Cloudinary integration against the live Cloudinary CDN.
 *
 *   1. Server-Timing: the parser reads real headers captured from both of
 *      Cloudinary's CDNs (Akamai's escaped quotes, Cloudflare's bare ones).
 *   2. Audit stamps: sample assets (synthetic capture times) stamp `SAMPLE`,
 *      never a date; uploaded assets stamp their capture day.
 *   3. Contract: the sample dataset is the 15 field records (no generic
 *      Cloudinary reference assets), there are 9 pipeline presets, every preset
 *      suggestion names a record that exists, every video carries its duration,
 *      and no generative step ships with a prompt written for one sample frame.
 *   4. Dataset: every sample asset's thumbnail, display rendition, original and
 *      fl_getinfo (AI signals) URL resolves on Cloudinary, the live
 *      Server-Timing parses, and the record's dimensions, byte size and (for
 *      video) duration are Cloudinary's own (`owidth`/`oheight`, `obytes`, `odu`).
 *   5. Preset suggestions: face redaction is only suggested for assets where
 *      Cloudinary actually detects faces.
 *   6. Search: the example questions return the records they should, with no
 *      silently dropped words, and matches on Cloudinary's AI understanding
 *      (caption, detected objects, auto-tags) are attributed to the AI — never
 *      to the human-classified record — while a generic category stays strict.
 *   7. Code export: the exact Node SDK transformation objects VisualOps exports,
 *      run through the real `cloudinary` SDK, and the exact next-cloudinary props,
 *      run through next-cloudinary's URL loader, produce the same transformation
 *      components as the URL VisualOps renders.
 *   8. Presets: every pipeline preset renders on a representative asset
 *      (HTTP 200, or 423 while Cloudinary finishes asynchronous AI work), and
 *      the smart crop never upscales an image while keeping its aspect ratio.
 *
 * Usage:  npm run verify:cloudinary            (all checks)
 *         npm run verify:cloudinary -- --quick (skip rendering presets, smart crops and report frames)
 *
 * No credentials are needed: everything runs against Cloudinary's public demo cloud.
 * (AI Content Analysis needs the team's own cloud and the Admin API, so it is not
 * called here; the search checks use a record shaped exactly like its output.)
 */
import ts from 'typescript';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quick = process.argv.includes('--quick');
const require = createRequire(import.meta.url);

/* ---------------------------------------------------------------------- */
/* 1. Load src/lib (TypeScript) with the project's own compiler            */
/* ---------------------------------------------------------------------- */

const srcLib = join(root, 'src', 'lib');
const outDir = join(tmpdir(), `visualops-verify-${process.pid}`);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : full.endsWith('.ts') ? [full] : [];
  });
}

for (const file of walk(srcLib)) {
  const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  });
  const outFile = join(outDir, relative(srcLib, file).replace(/\.ts$/, '.mjs'));
  const rewritten = outputText.replace(/from\s+['"](@\/lib\/[^'"]+|\.{1,2}\/[^'"]+)['"]/g, (_m, spec) => {
    const target = spec.startsWith('@/lib/')
      ? join(outDir, `${spec.slice('@/lib/'.length)}.mjs`)
      : join(dirname(outFile), `${spec}.mjs`);
    let rel = relative(dirname(outFile), target).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = `./${rel}`;
    return `from '${rel}'`;
  });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, rewritten);
}

const lib = (path) => import(pathToFileURL(join(outDir, path)).href);
const { buildSampleAssets } = await lib('data/dataset.mjs');
const media = await lib('cloudinary/media.mjs');
const pipeline = await lib('cloudinary/pipeline.mjs');
const codegen = await lib('cloudinary/codegen.mjs');
const { probeUrl, parseServerTiming, IMAGE_ACCEPT } = await lib('cloudinary/probe.mjs');
const { parseInsight } = await lib('cloudinary/insights.mjs');
const { isoDay } = await lib('format.mjs');
const report = await lib('report.mjs');
const search = await lib('search/query.mjs');

const cloudinary = require('cloudinary').v2;
const { constructCloudinaryUrl } = await import('@cloudinary-util/url-loader');

/* ---------------------------------------------------------------------- */
/* Helpers                                                                 */
/* ---------------------------------------------------------------------- */

const results = [];
const record = (section, name, ok, detail = '') => {
  results.push({ section, name, ok, detail });
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail ? `  — ${detail}` : ''}`);
};

const normalizeComponent = (c) => c.split(',').sort().join(',');

/** Transformation components of a delivery URL, given the public id it ends with. */
function componentsOf(url, publicId) {
  const clean = url.replace(/\?.*$/, '');
  const m = clean.match(/^https:\/\/res\.cloudinary\.com\/[^/]+\/(?:image|video)\/upload\/(.*)$/);
  if (!m) return null;
  let rest = m[1];
  const encodedId = publicId.split('/').map(encodeURIComponent).join('/');
  rest = rest.replace(new RegExp(`/?(v\\d+/)?${encodedId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\.[a-z0-9]+)?$`), '');
  return rest ? rest.split('/').filter(Boolean).map(normalizeComponent) : [];
}

async function probe(url, accept, { pollFor423 = 0 } = {}) {
  const deadline = Date.now() + pollFor423;
  for (;;) {
    const res = await probeUrl(url, { accept });
    if (res.kind !== 'processing' || Date.now() > deadline) return res;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

const describe = (res) =>
  res.kind === 'ready'
    ? `${res.metrics.status} ${res.metrics.format ?? ''} ${res.metrics.bytes ?? '?'}B`
    : res.kind === 'processing'
      ? '423 processing (async AI, accepted)'
      : `${res.status ?? ''} ${res.message}`;

const now = Date.now();
const assets = buildSampleAssets(now);

/* ---------------------------------------------------------------------- */
/* 2. Server-Timing parser — real headers from both of Cloudinary's CDNs   */
/* ---------------------------------------------------------------------- */

console.log('\nServer-Timing parser — headers captured from Akamai and Cloudflare');
const TIMING_FIXTURES = [
  {
    // Akamai escapes the nested quotes and closes content-info with `",cloudinary;dur=`.
    name: 'Akamai miss · video · escaped quotes (format=\\"mp4\\")',
    header: String.raw`cld-akam;dur=46;start=2026-09-26T20:59:51.826Z;desc=miss,rtt;dur=69,content-info;desc="width=854,height=480,abps=59435,fps=29.97,du=13.419,vc=\"h264\",bytes=797559,format=\"mp4\",crt=1790436060,owidth=854,oheight=480,oabps=678005,ofps=29.97,odu=13.413,ovc=\"h264\",obytes=9094354,oformat=\"mp4\",ocrt=1426536413,ef=(18,41,99)",cloudinary;dur=86;start=2026-09-26T18:04:07.722Z`,
    expect: {
      cache: 'miss', edgeMs: 46, rttMs: 69, cloudinaryMs: 86, transformMs: undefined,
      bytes: 797559, format: 'mp4', width: 854, height: 480,
      originalBytes: 9094354, originalFormat: 'mp4', originalWidth: 854, originalHeight: 480,
      duration: 13.419, originalDuration: 13.413,
    },
  },
  {
    name: 'Akamai miss · rendered now (cpu=, cld-id, transformation;dur)',
    header: String.raw`cld-akam;dur=767;cpu=75;start=2026-09-26T20:59:52.257Z;desc=miss,rtt;dur=52,content-info;desc="backfill_id=\"57d27b75f7e82d5b4d0f352839da618b-9c13ef7f02d7017a4326d5e5baa2ce6d-io-worker-production-f78495674-dv26p\"",cloudinary;dur=495;start=2026-09-26T20:59:52.405Z,cld-id;desc=57d27b75f7e82d5b4d0f352839da618b,transformation;dur=124`,
    expect: { cache: 'miss', edgeMs: 767, rttMs: 52, cloudinaryMs: 495, transformMs: 124, bytes: undefined, format: undefined },
  },
  {
    // Cloudflare leaves the quotes bare and closes content-info with `";cloudinary;dur=`.
    name: 'Cloudflare miss · image · bare quotes (format="avif")',
    header: String.raw`cld-cloudflare;dur=728;start=2026-09-26T21:05:12.841Z;desc=miss,rtt;dur=77,content-info;desc="width=864,height=576,bytes=43278,format="avif",owidth=864,oheight=576,obytes=109669,oformat="jpg",crt=1790456713,ocrt=1610625835,ef=(1,11,13,17,97);";cloudinary;dur=459;start=2026-09-26T21:05:12.990Z,cld-id;desc=5a7d2f401381ab07026d888d1bea0995,transformation;dur=314`,
    expect: {
      cache: 'miss', edgeMs: 728, rttMs: 77, cloudinaryMs: 459, transformMs: 314,
      bytes: 43278, format: 'avif', width: 864, height: 576,
      originalBytes: 109669, originalFormat: 'jpg', originalWidth: 864, originalHeight: 576,
      duration: undefined, originalDuration: undefined,
    },
  },
  {
    name: 'Cloudflare hit · no origin entry',
    header: String.raw`cld-cloudflare;dur=8;start=2026-09-26T21:05:12.840Z;desc=hit,rtt;dur=77,content-info;desc="width=624,height=351,bytes=57693,format="avif",owidth=624,oheight=500,obytes=80967,oformat="jpg",crt=1790448263,ocrt=1683303347,ef=(1,11,13,17,23,34);"`,
    expect: {
      cache: 'hit', edgeMs: 8, rttMs: 77, cloudinaryMs: undefined, transformMs: undefined,
      bytes: 57693, format: 'avif', width: 624, height: 351,
      originalBytes: 80967, originalFormat: 'jpg', originalWidth: 624, originalHeight: 500,
    },
  },
  {
    name: 'Cloudflare 404 · `rtt;dur=…;cloudinary;dur=…` and cld-error',
    header: String.raw`cld-cloudflare;dur=420;start=2026-09-26T21:05:12.838Z;desc=miss,rtt;dur=77;cloudinary;dur=96;start=2026-09-26T21:05:13.043Z,cld-id;desc=ec21e20c4220e7789539407cd4d035da,cld-error;desc="Resource not found - does-not-exist-xyz"`,
    expect: { cache: 'miss', edgeMs: 420, rttMs: 77, cloudinaryMs: 96, bytes: undefined, format: undefined },
  },
];
for (const { name, header, expect } of TIMING_FIXTURES) {
  const parsed = parseServerTiming(header);
  const wrong = Object.entries(expect).filter(([key, value]) => parsed[key] !== value);
  record(
    'timing',
    name,
    wrong.length === 0,
    wrong.length
      ? wrong.map(([key, value]) => `${key}: got ${parsed[key]}, want ${value}`).join('; ')
      : `edge ${parsed.edgeMs} ms · rtt ${parsed.rttMs} ms · origin ${parsed.cloudinaryMs ?? '— (cached)'}${parsed.format ? ` · ${parsed.format} ${parsed.bytes}B` : ''}`,
  );
}

/* ---------------------------------------------------------------------- */
/* 3. Audit stamp dates                                                    */
/* ---------------------------------------------------------------------- */

console.log('\nAudit stamps — sample capture times are synthetic, so {date} never burns one in');
{
  const samples = assets.filter((a) => a.source === 'sample');
  const leaked = samples.filter((a) => pipeline.expandStampText('{date}', a) !== 'SAMPLE');
  record(
    'stamp',
    `{date} on ${samples.length} sample assets`,
    samples.length > 0 && leaked.length === 0,
    leaked.length ? `real-looking date on ${leaked.map((a) => a.id).join(', ')}` : '→ "SAMPLE"',
  );
  const upload = { ...samples[0], source: 'upload', capturedAt: '2026-03-14T09:30:00.000Z' };
  const got = pipeline.expandStampText('{id} · {date}', upload);
  const want = `${upload.finding?.id ?? upload.id.toUpperCase()} · ${isoDay(upload.capturedAt)}`;
  record('stamp', '{date} on an uploaded asset', got === want, `"${got}"${got === want ? '' : ` ≠ "${want}"`}`);
}

/* ---------------------------------------------------------------------- */
/* 3b. Contract — dataset and presets                                       */
/* ---------------------------------------------------------------------- */

const EXPECTED_ASSETS = 15;
const EXPECTED_PRESETS = 9;
/** Generative steps whose prompts name something in one particular frame. */
const PROMPT_STEPS = ['gen_background_replace', 'gen_replace', 'gen_recolor', 'gen_remove'];

console.log('\nContract — the sample dataset and the pipeline presets');
{
  const ids = new Set(assets.map((a) => a.id));
  record(
    'contract',
    `${EXPECTED_ASSETS} sample records`,
    assets.length === EXPECTED_ASSETS && ids.size === assets.length,
    `${assets.length} assets, ${ids.size} unique ids`,
  );
  const notField = assets.filter((a) => a.collection !== 'field');
  record(
    'contract',
    'every sample is a field record (no generic Cloudinary reference assets)',
    notField.length === 0,
    notField.length ? `not field: ${notField.map((a) => a.id).join(', ')}` : 'collection: field × all',
  );
  const noAi = assets.filter((a) => a.ai !== undefined);
  record(
    'contract',
    'no sample claims an AI result (AI Content Analysis runs on the team cloud only)',
    noAi.length === 0,
    noAi.length ? `ai set on ${noAi.map((a) => a.id).join(', ')}` : 'ai: undefined × all',
  );
  const videos = assets.filter((a) => a.resourceType === 'video');
  const badVideos = videos.filter((a) => !(a.duration > 0) || !((a.posterOffset ?? 1) < a.duration));
  record(
    'contract',
    `every video carries its duration (${videos.length} videos)`,
    videos.length > 0 && badVideos.length === 0,
    badVideos.length
      ? `missing or poster past the end: ${badVideos.map((a) => a.id).join(', ')}`
      : videos.map((a) => `${a.id} ${a.duration}s`).join(', '),
  );
  const presetIds = new Set(pipeline.PRESETS.map((p) => p.id));
  record(
    'contract',
    `${EXPECTED_PRESETS} pipeline presets`,
    pipeline.PRESETS.length === EXPECTED_PRESETS && presetIds.size === pipeline.PRESETS.length,
    pipeline.PRESETS.map((p) => p.id).join(', '),
  );
  const dangling = pipeline.PRESETS.flatMap((p) =>
    (p.suggestedFor ?? [])
      .filter((id) => assets.find((a) => a.id === id)?.resourceType !== p.resourceType)
      .map((id) => `${p.id} → ${id}`),
  );
  record(
    'contract',
    'every preset suggestion names an existing record of the preset’s media type',
    dangling.length === 0,
    dangling.length ? dangling.join(', ') : 'ok',
  );
  const seeded = PROMPT_STEPS.flatMap((kind) => {
    const def = pipeline.STEP_DEFINITIONS[kind];
    return def.fields.filter((f) => f.type === 'text' && pipeline.str(def.defaults[f.key]) !== '').map((f) => `${kind}.${f.key}`);
  });
  record(
    'contract',
    'generative steps start with empty prompts (no sample-specific defaults)',
    seeded.length === 0,
    seeded.length ? `pre-filled: ${seeded.join(', ')}` : PROMPT_STEPS.join(', '),
  );
  // Frame-specific preset prompts apply only to the frames the preset suggests.
  const remediation = pipeline.PRESETS.find((p) => p.id === 'remediation-preview');
  const suggested = assets.find((a) => remediation?.suggestedFor?.includes(a.id));
  const other = assets.find((a) => a.resourceType === 'image' && !remediation?.suggestedFor?.includes(a.id));
  const replaceOn = (asset) => pipeline.presetSteps(remediation, asset).find((s) => s.kind === 'gen_replace');
  const onSuggested = suggested ? replaceOn(suggested) : undefined;
  const onOther = other ? replaceOn(other) : undefined;
  record(
    'contract',
    'remediation-preview prompts apply only to the frame they were written for',
    Boolean(onSuggested?.params.from && onSuggested?.params.to && onOther && !onOther.params.from && !onOther.params.to),
    `${suggested?.id}: “${onSuggested?.params.from}” → “${onSuggested?.params.to}”; ${other?.id}: “${onOther?.params.from ?? ''}” → “${onOther?.params.to ?? ''}”`,
  );
}

/* ---------------------------------------------------------------------- */
/* 4. Dataset URLs                                                         */
/* ---------------------------------------------------------------------- */

console.log(`\nDataset — ${assets.length} assets on Cloudinary's demo cloud`);
/** Cloudinary's automatic face detections per asset (fl_getinfo), for the preset checks below. */
const faceDetections = new Map();
await Promise.all(
  assets.map(async (asset) => {
    const checks = [
      ['thumb', media.thumbUrl(asset, 480, 270), IMAGE_ACCEPT],
      ['display', media.displayUrl(asset, 1600), IMAGE_ACCEPT],
      ['original', media.originalUrl(asset), undefined],
    ];
    if (asset.resourceType === 'video') checks.push(['playback', media.playbackUrl(asset), undefined]);
    const outcomes = await Promise.all(checks.map(([, url, accept]) => probe(url, accept)));
    const failed = outcomes.map((o, i) => [checks[i][0], o]).filter(([, o]) => o.kind !== 'ready');
    let insightNote = '';
    try {
      const res = await fetch(media.insightUrl(asset));
      if (!res.ok) throw new Error(res.headers.get('x-cld-error') ?? `HTTP ${res.status}`);
      const insight = parseInsight(media.insightUrl(asset), await res.json());
      faceDetections.set(asset.id, insight.faces.length);
      insightNote = `fl_getinfo ${insight.inputWidth}×${insight.inputHeight}, face detections ${insight.faces.length}${insight.focus ? ', g_auto crop' : ''}`;
    } catch (error) {
      failed.push(['fl_getinfo', { kind: 'error', message: error.message }]);
    }
    const display = outcomes[1].kind === 'ready' ? outcomes[1].metrics : undefined;
    if (display) {
      // The UI's cache / edge-time / size readouts come from this parse, on whichever CDN answered.
      const unparsed = ['cache', 'edgeMs', 'bytes', 'format', 'originalWidth', 'originalHeight'].filter((k) => display[k] === undefined);
      if (unparsed.length) failed.push(['server-timing', { kind: 'error', message: `not parsed: ${unparsed.join(', ')}` }]);
      // Smart crop caps its width from the record's dimensions (no upscaling), so they must be Cloudinary's.
      else if (display.originalWidth !== asset.width || display.originalHeight !== asset.height) {
        failed.push(['dimensions', { kind: 'error', message: `record ${asset.width}×${asset.height} ≠ Cloudinary ${display.originalWidth}×${display.originalHeight}` }]);
      }
    }
    // The stored file as Cloudinary describes it: a still's content-info describes the image for photos;
    // for video only the playback rendition's `o*` fields describe the stored clip (a frame grab's do not).
    const isVideo = asset.resourceType === 'video';
    const stored = isVideo ? (outcomes[3]?.kind === 'ready' ? outcomes[3].metrics : undefined) : display;
    let durationNote = '';
    if (stored) {
      if (asset.bytes !== undefined && stored.originalBytes !== undefined && stored.originalBytes !== asset.bytes) {
        failed.push(['bytes', { kind: 'error', message: `record ${asset.bytes}B ≠ Cloudinary ${stored.originalBytes}B` }]);
      }
      if (!isVideo && stored.originalFormat && stored.originalFormat !== asset.format) {
        failed.push(['format', { kind: 'error', message: `record ${asset.format} ≠ Cloudinary ${stored.originalFormat}` }]);
      }
      if (isVideo) {
        if (stored.originalDuration === undefined) {
          failed.push(['duration', { kind: 'error', message: 'Cloudinary reported no odu' }]);
        } else if (!(Math.abs(stored.originalDuration - (asset.duration ?? 0)) <= 0.01)) {
          failed.push(['duration', { kind: 'error', message: `record ${asset.duration ?? '—'} s ≠ Cloudinary ${stored.originalDuration} s` }]);
        } else {
          durationNote = `, ${stored.originalDuration} s (odu)`;
        }
      }
    }
    const savings =
      display?.originalBytes && display.bytes
        ? `, ${display.originalFormat} ${display.originalBytes}B → ${display.format} ${display.bytes}B${durationNote}`
        : durationNote;
    record(
      'dataset',
      `${asset.id} (${asset.resourceType})`,
      failed.length === 0,
      failed.length ? failed.map(([n, o]) => `${n}: ${describe(o)}`).join('; ') : `${insightNote}${savings}`,
    );
  }),
);

/* ---------------------------------------------------------------------- */
/* 5. Preset suggestions match what Cloudinary detects                     */
/* ---------------------------------------------------------------------- */

console.log('\nPreset suggestions — face redaction is only suggested where Cloudinary detects faces');
for (const preset of pipeline.PRESETS.filter((p) => p.steps.some((s) => s.kind === 'privacy_faces'))) {
  const ids = preset.suggestedFor ?? [];
  const without = ids.filter((id) => !(faceDetections.get(id) > 0));
  record(
    'presets',
    `${preset.id} suggested for [${ids.join(', ')}]`,
    ids.length > 0 && without.length === 0,
    without.length
      ? `no Cloudinary face detections on ${without.join(', ')}`
      : ids.map((id) => `${id}: ${faceDetections.get(id)} face detection${faceDetections.get(id) === 1 ? '' : 's'}`).join(', '),
  );
}

/* ---------------------------------------------------------------------- */
/* 5b. Search — example questions and AI attribution                       */
/* ---------------------------------------------------------------------- */

console.log('\nSearch — example questions, and AI matches attributed to Cloudinary’s AI');
{
  const sites = Array.from(new Set(assets.map((a) => a.site)));
  const ask = (q, pool = assets) => search.runQuery(search.parseQuery(q, sites, now), pool);
  const idsOf = (result) => result.hits.map((h) => h.asset.id);
  const HOUR = 3_600_000;
  const within72h = (a) => now - new Date(a.capturedAt).getTime() < 72 * HOUR;
  /** What each example must return on the sample dataset (exactly, as a set). */
  const EXPECT = {
    'Show severe structural findings': assets
      .filter((a) => a.finding?.category === 'structural' && ['critical', 'high'].includes(a.finding.severity))
      .map((a) => a.id),
    'Find bridge inspection media': ['vo-bridge-truss'],
    'Show images with cracks': ['vo-road-collapse'],
    'Find recent safety incidents': assets.filter((a) => a.finding?.category === 'safety' && within72h(a)).map((a) => a.id),
    sinkhole: ['vo-road-collapse'],
    trucks: ['vo-fleet-checkin', 'vo-equipment-yard'],
    'Show evidence related to VO-1042': ['vo-road-collapse'],
  };
  const missing = search.EXAMPLE_QUERIES.filter((q) => !(q in EXPECT));
  record('search', 'every example question has an expectation', missing.length === 0, missing.length ? missing.join(', ') : `${search.EXAMPLE_QUERIES.length} examples`);
  for (const q of search.EXAMPLE_QUERIES.filter((x) => x in EXPECT)) {
    const result = ask(q);
    const got = new Set(idsOf(result));
    const want = new Set(EXPECT[q]);
    const same = got.size === want.size && [...want].every((id) => got.has(id));
    const honest = result.unmatchedKeywords.length === 0 && !result.relaxed;
    record(
      'search',
      `“${q}”`,
      same && honest && want.size > 0,
      `${[...got].join(', ') || 'nothing'}${same ? '' : ` ≠ ${[...want].join(', ')}`}${honest ? '' : ` · unmatched [${result.unmatchedKeywords}]${result.relaxed ? ' · relaxed' : ''}`}`,
    );
  }

  // A record shaped exactly like POST /api/assets/[id]/analyze leaves it: Cloudinary's caption and COCO
  // objects in `ai`, and the auto-tag both on the asset's tags and listed again in ai.tags.
  const base = assets.find((a) => a.id === 'vo-road-collapse');
  const analysed = {
    ...base,
    id: 'check-ai-record',
    tags: [...base.tags.filter((t) => t !== 'sinkhole'), 'truck'],
    title: 'Carriageway failure at kerb line',
    finding: { ...base.finding, id: 'VO-CHECK', title: 'Carriageway failure at kerb line' },
    ai: {
      caption: 'A large sinkhole has opened in the road beside a parked truck',
      objects: [{ label: 'truck', confidence: 0.77, box: { x: 60, y: 20, w: 30, h: 25, label: 'TRUCK' } }],
      tags: ['truck'],
      model: 'captioning v6 · coco v2',
    },
  };
  const pool = [analysed, ...assets.filter((a) => a.id !== base.id)];
  const hitOf = (result, id) => result.hits.find((h) => h.asset.id === id);

  const trucks = ask('trucks', pool);
  const aiHit = hitOf(trucks, analysed.id);
  const aiMatch = aiHit?.matches.find((m) => m.keyword === 'truck');
  record(
    'search',
    '“trucks” finds a structural record whose truck Cloudinary detected — attributed to AI',
    Boolean(aiMatch) && search.matchSourceOf(aiMatch) === 'ai' && Boolean(hitOf(trucks, 'vo-fleet-checkin')),
    aiMatch ? `${analysed.id}: ${aiMatch.fields.join(' + ')} → ${search.matchSourceOf(aiMatch)}` : 'not returned',
  );
  const human = hitOf(trucks, 'vo-fleet-checkin')?.matches.find((m) => m.keyword === 'truck');
  record(
    'search',
    'a human-tagged truck is attributed to the record, not the AI',
    Boolean(human) && search.matchSourceOf(human) === 'human',
    human ? `vo-fleet-checkin: ${human.fields.join(' + ')} → ${search.matchSourceOf(human)}` : 'not returned',
  );
  const caption = hitOf(ask('sinkhole', pool), analysed.id)?.matches.find((m) => m.keyword === 'sinkhole');
  record(
    'search',
    '“sinkhole” matches the AI caption when no human field says it',
    Boolean(caption) && caption.fields.length === 1 && caption.fields[0] === 'ai-caption',
    caption ? `${caption.fields.join(' + ')}` : 'not returned',
  );
  const withoutAi = ask('trucks', [{ ...analysed, ai: undefined, tags: base.tags }, ...assets.filter((a) => a.id !== base.id)]);
  record(
    'search',
    'without AI understanding the same record is not returned for “trucks”',
    !hitOf(withoutAi, analysed.id),
    idsOf(withoutAi).join(', '),
  );
  const strict = ask('equipment with trucks', pool);
  record(
    'search',
    'a generic category word stays strict (“equipment with trucks” excludes the structural record)',
    !hitOf(strict, analysed.id) && strict.hits.length > 0,
    idsOf(strict).join(', '),
  );
}

/* ---------------------------------------------------------------------- */
/* 6. Code export parity                                                   */
/* ---------------------------------------------------------------------- */

console.log('\nCode export — Node SDK and next-cloudinary reproduce the rendered transformations');
cloudinary.config({ cloud_name: 'demo', secure: true });

const representative = (preset) =>
  assets.find((a) => preset.suggestedFor?.includes(a.id) && a.resourceType === preset.resourceType) ??
  assets.find((a) => a.resourceType === preset.resourceType && a.collection === 'field');

/**
 * Prompts for the generative steps, whose defaults are empty (the Studio suggests an object from the
 * asset itself). Parity is checked with a real prompt as well as with the empty default.
 */
const EXAMPLE_PARAMS = {
  gen_background_replace: { prompt: 'clean concrete depot floor in soft overcast daylight' },
  gen_replace: { from: 'mop', to: 'yellow wet floor warning sign' },
  gen_recolor: { prompt: 'hard hat', color: 'FF6A00' },
  gen_remove: { prompt: 'mop bucket' },
};

// Every step kind on an asset it applies to: its defaults, and example prompts where defaults are empty.
const everyStep = pipeline.STEP_ORDER.flatMap((kind) => {
  const def = pipeline.STEP_DEFINITIONS[kind];
  const asset = assets.find((a) => def.appliesTo.includes(a.resourceType) && a.collection === 'field');
  const cases = [{ name: `step:${kind}`, asset, steps: [pipeline.createStep(kind)] }];
  if (EXAMPLE_PARAMS[kind]) cases.push({ name: `step:${kind} (prompt)`, asset, steps: [pipeline.createStep(kind, EXAMPLE_PARAMS[kind])] });
  return cases;
});
const presetCases = pipeline.PRESETS.map((preset) => {
  const asset = representative(preset);
  return { name: `preset:${preset.id}`, asset, steps: pipeline.presetSteps(preset, asset) };
});

for (const { name, asset, steps } of [...everyStep, ...presetCases]) {
  const expected = pipeline.pipelineComponents(steps, asset).map(normalizeComponent);

  // Node SDK
  const sdkUrl = cloudinary.url(asset.publicId, {
    resource_type: asset.resourceType,
    ...(asset.resourceType === 'video' ? { format: 'mp4' } : {}),
    transformation: codegen.sdkTransformations(steps, asset),
  });
  const sdkComponents = componentsOf(sdkUrl, asset.publicId);
  const sdkOk = JSON.stringify(sdkComponents) === JSON.stringify(expected);

  // next-cloudinary (CldImage props / getCldVideoUrl rawTransformations)
  let cldOk = true;
  let cldDetail = '';
  try {
    const options =
      asset.resourceType === 'video'
        ? { src: asset.publicId, assetType: 'video', rawTransformations: pipeline.pipelineComponents(steps, asset) }
        : (() => {
            const spec = codegen.cldImageSpec(steps, asset);
            // The exact `width` the exported CldImage snippet carries.
            return { src: asset.publicId, width: codegen.cldImageWidth(steps, asset), ...spec.props, rawTransformations: spec.rawTransformations };
          })();
    const cldUrl = constructCloudinaryUrl({ options, config: { cloud: { cloudName: 'demo' } } });
    const actual = componentsOf(cldUrl, asset.publicId) ?? [];
    const extras = (c) => /^c_limit,w_\d+$/.test(c) || c === 'f_auto' || c === 'q_auto' || /^f_auto:/.test(c);
    const want = expected.filter((c) => !['f_auto', 'q_auto', 'vc_auto'].includes(c) && !/^q_auto/.test(c));
    const missing = want.filter((c) => !actual.includes(c));
    const unexpected = actual.filter((c) => !extras(c) && !expected.includes(c));
    cldOk = missing.length === 0 && unexpected.length === 0;
    cldDetail = cldOk ? '' : ` next-cloudinary missing [${missing}] extra [${unexpected}]`;
  } catch (error) {
    cldOk = false;
    cldDetail = ` next-cloudinary error: ${error.message}`;
  }

  record(
    'codegen',
    `${name} on ${asset.id}`,
    sdkOk && cldOk,
    sdkOk && cldOk ? expected.join('/') || '(no-op)' : `${sdkOk ? '' : `SDK ${sdkComponents?.join('/')} ≠ ${expected.join('/')}`}${cldDetail}`,
  );
}

/* ---------------------------------------------------------------------- */
/* 7. Presets and smart crops render on Cloudinary                         */
/* ---------------------------------------------------------------------- */

if (!quick) {
  console.log('\nPresets — rendered live on Cloudinary (generative steps can take ~10 s on first render)');
  for (const preset of pipeline.PRESETS) {
    const asset = representative(preset);
    const url = pipeline.pipelineUrl(pipeline.presetSteps(preset, asset), asset);
    const res = await probe(url, asset.resourceType === 'image' ? IMAGE_ACCEPT : undefined, { pollFor423: 90_000 });
    record('presets', `${preset.id} on ${asset.id}`, res.kind === 'ready' || res.kind === 'processing', describe(res));
  }

  console.log('\nSmart crop — c_fill crops and downscales only, never upscales (default 16:9, ≤1600 px)');
  await Promise.all(
    assets
      .filter((a) => a.resourceType === 'image')
      .map(async (asset) => {
        const step = pipeline.createStep('smart_crop');
        const res = await probe(pipeline.pipelineUrl([step], asset), IMAGE_ACCEPT);
        if (res.kind !== 'ready') return record('smart-crop', asset.id, false, describe(res));
        const { width: w, height: h, originalWidth: ow, originalHeight: oh, bytes, originalBytes } = res.metrics;
        const [aw, ah] = pipeline.aspect(step.params.aspect).split(':').map(Number);
        const measured = [w, h, ow, oh].every((v) => v !== undefined);
        const upscaled = !(w <= ow && h <= oh);
        // Cloudinary rounds the height to whole pixels: allow one pixel of drift from the exact ratio.
        const offAspect = Math.abs(w * ah - h * aw) > aw;
        record(
          'smart-crop',
          asset.id,
          measured && !upscaled && !offAspect,
          `${w}×${h} from ${ow}×${oh}${upscaled ? ' — UPSCALED' : ''}${offAspect ? ` — not ${aw}:${ah}` : ''} · ${bytes}B vs original ${originalBytes}B`,
        );
      }),
  );

  console.log('\nReport evidence frames (stamp + redaction)');
  for (const asset of assets.filter((a) => a.finding).slice(0, 4)) {
    const res = await probe(report.evidenceStillUrl(asset, true), IMAGE_ACCEPT, { pollFor423: 60_000 });
    record('report', `evidence ${asset.finding.id}`, res.kind === 'ready', describe(res));
  }
}

/* ---------------------------------------------------------------------- */

rmSync(outDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed${failed.length ? ` — ${failed.length} failed` : ''}.`);
process.exit(failed.length ? 1 : 0);
