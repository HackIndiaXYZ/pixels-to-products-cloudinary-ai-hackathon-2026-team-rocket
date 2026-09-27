#!/usr/bin/env node
/**
 * Verifies the VisualOps ⇄ Cloudinary integration against the live Cloudinary CDN.
 *
 *   1. Server-Timing: the parser reads real headers captured from both of
 *      Cloudinary's CDNs (Akamai's escaped quotes, Cloudflare's bare ones).
 *   2. Audit stamps: sample assets (synthetic capture times) stamp `SAMPLE`,
 *      never a date; uploaded assets stamp their capture day.
 *   3. Dataset: every sample asset's thumbnail, display rendition, original and
 *      fl_getinfo (AI signals) URL resolves on Cloudinary, the live
 *      Server-Timing parses, and the record's dimensions are Cloudinary's.
 *   4. Preset suggestions: face redaction is only suggested for assets where
 *      Cloudinary actually detects faces.
 *   5. Code export: the exact Node SDK transformation objects VisualOps exports,
 *      run through the real `cloudinary` SDK, and the exact next-cloudinary props,
 *      run through next-cloudinary's URL loader, produce the same transformation
 *      components as the URL VisualOps renders.
 *   6. Presets: every pipeline preset renders on a representative asset
 *      (HTTP 200, or 423 while Cloudinary finishes asynchronous AI work), and
 *      the smart crop never upscales an image while keeping its aspect ratio.
 *
 * Usage:  npm run verify:cloudinary            (all checks)
 *         npm run verify:cloudinary -- --quick (skip rendering presets, smart crops and report frames)
 *
 * No credentials are needed: everything runs against Cloudinary's public demo cloud.
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
    const savings =
      display?.originalBytes && display.bytes
        ? `, ${display.originalFormat} ${display.originalBytes}B → ${display.format} ${display.bytes}B`
        : '';
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
/* 6. Code export parity                                                   */
/* ---------------------------------------------------------------------- */

console.log('\nCode export — Node SDK and next-cloudinary reproduce the rendered transformations');
cloudinary.config({ cloud_name: 'demo', secure: true });

const representative = (preset) =>
  assets.find((a) => preset.suggestedFor?.includes(a.id) && a.resourceType === preset.resourceType) ??
  assets.find((a) => a.resourceType === preset.resourceType && a.collection === 'field');

// Every step kind, with non-default parameters, on an asset it applies to.
const everyStep = pipeline.STEP_ORDER.map((kind) => {
  const def = pipeline.STEP_DEFINITIONS[kind];
  const asset = assets.find((a) => def.appliesTo.includes(a.resourceType) && a.collection === 'field');
  return { name: `step:${kind}`, asset, steps: [pipeline.createStep(kind)] };
});
const presetCases = pipeline.PRESETS.map((preset) => ({
  name: `preset:${preset.id}`,
  asset: representative(preset),
  steps: pipeline.presetSteps(preset),
}));

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
    const url = pipeline.pipelineUrl(pipeline.presetSteps(preset), asset);
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
