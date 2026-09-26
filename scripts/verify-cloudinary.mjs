#!/usr/bin/env node
/**
 * Verifies the VisualOps ⇄ Cloudinary integration against the live Cloudinary CDN.
 *
 *   1. Dataset: every sample asset's thumbnail, display rendition, original and
 *      fl_getinfo (AI signals) URL resolves on Cloudinary.
 *   2. Presets: every pipeline preset renders on a representative asset
 *      (HTTP 200, or 423 while Cloudinary finishes asynchronous AI work).
 *   3. Code export: the exact Node SDK transformation objects VisualOps exports,
 *      run through the real `cloudinary` SDK, and the exact next-cloudinary props,
 *      run through next-cloudinary's URL loader, produce the same transformation
 *      components as the URL VisualOps renders.
 *
 * Usage:  npm run verify:cloudinary            (all checks)
 *         npm run verify:cloudinary -- --quick (skip rendering the presets)
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
const { probeUrl, IMAGE_ACCEPT } = await lib('cloudinary/probe.mjs');
const { parseInsight } = await lib('cloudinary/insights.mjs');
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
/* 2. Dataset URLs                                                         */
/* ---------------------------------------------------------------------- */

console.log(`\nDataset — ${assets.length} assets on Cloudinary's demo cloud`);
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
      insightNote = `fl_getinfo ${insight.inputWidth}×${insight.inputHeight}, faces ${insight.faces.length}${insight.focus ? ', g_auto region' : ''}`;
    } catch (error) {
      failed.push(['fl_getinfo', { kind: 'error', message: error.message }]);
    }
    const display = outcomes[1].kind === 'ready' ? outcomes[1].metrics : undefined;
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
/* 3. Code export parity                                                   */
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
            return { src: asset.publicId, width: Math.min(asset.width, 1600), ...spec.props, rawTransformations: spec.rawTransformations };
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
/* 4. Presets render on Cloudinary                                         */
/* ---------------------------------------------------------------------- */

if (!quick) {
  console.log('\nPresets — rendered live on Cloudinary (generative steps can take ~10 s on first render)');
  for (const preset of pipeline.PRESETS) {
    const asset = representative(preset);
    const url = pipeline.pipelineUrl(pipeline.presetSteps(preset), asset);
    const res = await probe(url, asset.resourceType === 'image' ? IMAGE_ACCEPT : undefined, { pollFor423: 90_000 });
    record('presets', `${preset.id} on ${asset.id}`, res.kind === 'ready' || res.kind === 'processing', describe(res));
  }

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
