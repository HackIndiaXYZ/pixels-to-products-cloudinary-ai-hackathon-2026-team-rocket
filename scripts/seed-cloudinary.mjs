#!/usr/bin/env node
/**
 * Imports the VisualOps sample workspace into the team's Cloudinary cloud, so the whole console runs on
 * real Cloudinary records (the console switches to its cloud workspace once the cloud holds records).
 *
 * For every field record of src/lib/data/dataset.ts (reference samples are left out):
 *   1. Upload (server-side, signed with the API secret) from Cloudinary's public demo cloud:
 *        images → the original file   https://res.cloudinary.com/demo/image/upload/<public id>.<format>
 *        videos → an H.264 MP4 rendition (c_limit,w_1280/q_auto/vc_auto), well under the free-plan size limit
 *      as public ID `visualops/<record id>`, tagged [VisualOps tag, category, site slug, …record tags], with
 *      the record as contextual metadata (keys: src/lib/cloudinary/record-context.ts; provenance
 *      "sample-annotation" — team-written annotations, labelled Human classified in the console) and, when
 *      the fields exist (npm run setup:cloudinary), structured metadata vo_category/vo_severity/vo_status/vo_site.
 *   2. Images only: Cloudinary AI Content Analysis — detection "captioning", then "coco_v2" with
 *      auto_tagging 0.5 (2 detections per image; videos use none). The result is parsed with
 *      src/lib/cloudinary/ai.ts and written into the context (ai_caption, ai_objects, ai_tags, ai_model,
 *      analyzed_at), merged with the context already on the asset.
 *
 * Idempotent: a record that already exists is skipped (only a missing AI analysis or missing structured
 * metadata is completed); --force re-uploads (overwrites) and re-analyses every record.
 *
 * Usage:  npm run seed:cloudinary -- --dry-run        the plan; no writes (reads only: demo CDN, and the
 *                                                     team cloud when credentials are set)
 *         npm run seed:cloudinary                     import what is missing
 *         npm run seed:cloudinary -- --force          re-import everything (uses 2 detections per image again)
 *   Options: --no-ai (skip AI detection) · --only=vo-road-collapse,vo-wet-floor · --offline (with
 *            --dry-run: no network at all)
 *
 * Credentials: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET (+ optional VISUALOPS_TAG)
 * from the environment or .env.local. Values are never printed.
 */
import ts from 'typescript';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  cloudinaryClient,
  errorStatus,
  errorText,
  loadCredentials,
  METADATA_FIELDS,
  metadataReady,
  printCredentialStatus,
} from './lib/cloudinary-admin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

/* -------------------------------------------------------------------------- */
/* Options                                                                     */
/* -------------------------------------------------------------------------- */

const USAGE = 'Usage: npm run seed:cloudinary [-- --dry-run] [--force] [--no-ai] [--only=id,id] [--offline]';
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const dryRun = flag('--dry-run');
const force = flag('--force');
const noAi = flag('--no-ai');
const offline = flag('--offline');
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null;
const unknownArgs = args.filter((a) => !['--dry-run', '--force', '--no-ai', '--offline'].includes(a) && !a.startsWith('--only='));
if (unknownArgs.length) {
  console.error(`Unknown option ${unknownArgs.join(' ')}.\n${USAGE}`);
  process.exit(2);
}
if (offline && !dryRun) {
  console.error('--offline only applies to --dry-run.');
  process.exit(2);
}

/** Public IDs of the seeded records: `visualops/<sample id>` (the console resolves sample ids to them). */
const SEED_FOLDER = 'visualops';
/** Largest source the free plan accepts for a video upload, with margin. */
const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
/** Cloudinary limits each context value to 1024 characters. */
const CONTEXT_VALUE_MAX = 1000;
/** Tags accepted by the VisualOps sanitizer (src/lib/cloudinary/ingest-fields.ts). */
const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const API_TIMEOUT_MS = 180_000;
const UPLOAD_TIMEOUT_MS = 300_000;
const HOUR = 3_600_000;

/* -------------------------------------------------------------------------- */
/* Load src/lib (TypeScript) with the project's own compiler                   */
/* -------------------------------------------------------------------------- */

const srcLib = join(root, 'src', 'lib');
const outDir = mkdtempSync(join(tmpdir(), 'visualops-seed-'));
process.on('exit', () => rmSync(outDir, { recursive: true, force: true }));

function resolveLibImport(fromFile, spec) {
  const base = spec.startsWith('@/lib/') ? join(srcLib, spec.slice('@/lib/'.length)) : resolve(dirname(fromFile), spec);
  for (const candidate of [`${base}.ts`, join(base, 'index.ts')]) if (existsSync(candidate)) return candidate;
  throw new Error(`Cannot resolve "${spec}" imported by ${relative(root, fromFile)}`);
}

/** Transpiles the entry modules and everything they import from src/lib into outDir (ES modules). */
function transpileLib(entries) {
  const queue = entries.map((e) => join(srcLib, e));
  const seen = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: file,
    });
    const outFile = join(outDir, relative(srcLib, file).replace(/\.ts$/, '.mjs'));
    const code = outputText.replace(/(\bfrom\s*|\bimport\s*)(['"])(@\/lib\/[^'"]+|\.{1,2}\/[^'"]+)\2/g, (_m, keyword, quote, spec) => {
      const target = resolveLibImport(file, spec);
      queue.push(target);
      let rel = relative(dirname(outFile), join(outDir, relative(srcLib, target).replace(/\.ts$/, '.mjs'))).replace(/\\/g, '/');
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return `${keyword}${quote}${rel}${quote}`;
    });
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, code);
  }
}

transpileLib(['data/dataset.ts', 'cloudinary/media.ts', 'cloudinary/ai.ts', 'cloudinary/record-context.ts']);
const lib = (path) => import(pathToFileURL(join(outDir, path)).href);
const { buildSampleAssets } = await lib('data/dataset.mjs');
const { playbackUrl } = await lib('cloudinary/media.mjs');
const { parseDetection, encodeAiContext } = await lib('cloudinary/ai.mjs');
const { CTX } = await lib('cloudinary/record-context.mjs');
const { DELIVERY_ORIGIN, encodePublicId } = await lib('cloudinary/url.mjs');

/* -------------------------------------------------------------------------- */
/* Plan                                                                        */
/* -------------------------------------------------------------------------- */

const now = Date.now();
let records = buildSampleAssets(now).filter((a) => a.collection === 'field');
if (only) {
  const unknownIds = only.filter((id) => !records.some((r) => r.id === id));
  if (unknownIds.length) {
    console.error(`Unknown record id ${unknownIds.join(', ')}. Field records: ${records.map((r) => r.id).join(', ')}`);
    process.exit(2);
  }
  records = records.filter((r) => only.includes(r.id));
}

const creds = loadCredentials(root);
const tag = creds.tag;

// Control characters are rejected in context values; keep each value within Cloudinary's limit.
const clean = (value) =>
  String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CONTEXT_VALUE_MAX);
const siteSlug = (site) => site.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');

function contextFor(asset) {
  const f = asset.finding;
  const r = f?.region;
  const ctx = {
    [CTX.title]: asset.title,
    [CTX.findingTitle]: f?.title && f.title !== asset.title ? f.title : undefined,
    [CTX.site]: asset.site,
    [CTX.zone]: asset.zone,
    [CTX.category]: f?.category,
    [CTX.severity]: f?.severity,
    [CTX.status]: f?.status,
    [CTX.note]: f?.summary,
    [CTX.action]: f?.action,
    [CTX.findingId]: f?.id,
    [CTX.capturedBy]: asset.capturedBy,
    [CTX.fileName]: asset.fileName,
    // "x,y,w,h,LABEL" in percent of the frame (the poster frame for video).
    [CTX.region]: r ? [r.x, r.y, r.w, r.h, ...(r.label ? [r.label.replace(/,/g, ' ')] : [])].join(',') : undefined,
    [CTX.posterOffset]: asset.resourceType === 'video' && asset.posterOffset !== undefined ? String(asset.posterOffset) : undefined,
    [CTX.source]: 'visualops',
    [CTX.provenance]: 'sample-annotation',
  };
  if (asset.captureBasis === 'fixed') {
    // The CCTV clip: the time burned into the footage (camera clock, zone unknown), kept verbatim.
    ctx[CTX.capturedAt] = asset.capturedAt;
    if (asset.cameraTime) ctx[CTX.cameraTime] = asset.cameraTime;
  } else {
    // Sample capture times are offsets, materialised against the viewer's clock (labelled sample time).
    ctx[CTX.sampleHoursAgo] = String(Math.round((now - Date.parse(asset.capturedAt)) / HOUR));
  }
  return Object.fromEntries(
    Object.entries(ctx)
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== '')
      .map(([k, v]) => [k, clean(v)]),
  );
}

function planFor(asset) {
  const f = asset.finding;
  const tags = Array.from(
    new Set([tag, f?.category, siteSlug(asset.site), ...asset.tags].filter(Boolean).map((t) => t.toLowerCase()).filter((t) => TAG_PATTERN.test(t))),
  );
  const metadata = f
    ? { vo_category: f.category, vo_severity: f.severity, vo_status: f.status, vo_site: clean(asset.site).slice(0, 60) }
    : { vo_site: clean(asset.site).slice(0, 60) };
  return {
    asset,
    id: asset.id,
    publicId: `${SEED_FOLDER}/${asset.id}`,
    resourceType: asset.resourceType,
    source:
      asset.resourceType === 'video'
        ? playbackUrl(asset) // c_limit,w_1280/q_auto/vc_auto → MP4 (the rendition the console plays)
        : `${DELIVERY_ORIGIN}/${asset.cloudName}/image/upload/${encodePublicId(asset.publicId)}.${asset.format}`,
    tags,
    context: contextFor(asset),
    metadata,
    analyze: asset.resourceType === 'image' && !noAi,
  };
}

const plans = records.map(planFor);
const images = plans.filter((p) => p.resourceType === 'image').length;

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const kb = (bytes) =>
  typeof bytes !== 'number' ? '?' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
const short = (text, n = 60) => (text && text.length > n ? `${text.slice(0, n - 1)}…` : (text ?? ''));
const pad = (s, n) => String(s).padEnd(n);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AI_KEYS = [CTX.aiCaption, CTX.aiObjects, CTX.aiTags, CTX.aiModel, CTX.analyzedAt];

/** HEAD on the public demo CDN; waits while Cloudinary is still rendering the rendition (HTTP 423). */
async function probeSource(url, { waitMs = 0 } = {}) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      const bytes = Number(res.headers.get('content-length')) || undefined;
      if (res.status === 423 && Date.now() < deadline) {
        await sleep(5000);
        continue;
      }
      return { ok: res.ok, status: res.status, bytes, type: res.headers.get('content-type') ?? '', error: res.headers.get('x-cld-error') ?? '' };
    } catch (error) {
      return { ok: false, status: 0, error: error.message };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Run                                                                         */
/* -------------------------------------------------------------------------- */

console.log(`VisualOps · seed the sample workspace into Cloudinary${dryRun ? ' (dry run: no writes)' : ''}${force ? ' · --force' : ''}\n`);
printCredentialStatus(creds);
if (!creds.config && !dryRun) {
  console.error(`\nMissing or invalid: ${creds.missing.join(', ')}. Add them to .env.local (see .env.example).`);
  process.exit(1);
}
const config = creds.config;
const online = !offline;
const cloudinary = config && online ? cloudinaryClient(require('cloudinary').v2, config) : null;

// Structured metadata is written only when all four fields exist (a missing field would fail the upload).
let metadataOn = false;
let metadataChecked = false;
let metadataNote = 'not checked (no credentials)';
if (cloudinary) {
  try {
    const listed = await cloudinary.api.list_metadata_fields();
    metadataOn = metadataReady(listed?.metadata_fields);
    metadataChecked = true;
    metadataNote = metadataOn
      ? `ready (${METADATA_FIELDS.map((f) => f.external_id).join(', ')})`
      : 'fields missing — run npm run setup:cloudinary to add them (records are imported without)';
  } catch (error) {
    metadataNote = `unavailable (${errorText(error, config)}) — records are imported without`;
  }
} else if (offline) {
  metadataNote = 'not checked (--offline)';
}

const aiNote = noAi
  ? 'off (--no-ai)'
  : `captioning + coco_v2 auto-tagging 0.5 on images (≤ 2 detections each, ≤ ${images * 2} for this run; videos: none)`;
console.log(`\nRecords:    ${plans.length} field records → public IDs ${SEED_FOLDER}/<id>, tag "${tag}"`);
console.log(`AI:         ${aiNote}`);
console.log(`Metadata:   ${metadataNote}\n`);

/** The record already in the cloud, or null (404). Throws on any other error. */
async function existingResource(plan) {
  try {
    return await cloudinary.api.resource(plan.publicId, { resource_type: plan.resourceType, timeout: API_TIMEOUT_MS });
  } catch (error) {
    if (errorStatus(error) === 404) return null;
    throw error;
  }
}

const hasAnalysis = (resource) => Boolean(resource?.context?.custom?.[CTX.analyzedAt]);
const hasTag = (resource) => (resource?.tags ?? []).includes(tag);
const hasMetadata = (resource) => METADATA_FIELDS.every((f) => resource?.metadata?.[f.external_id] !== undefined);

/* ---- dry run ---------------------------------------------------------------- */

if (dryRun) {
  let wouldDetect = 0;
  for (const plan of plans) {
    const probe = online ? await probeSource(plan.source) : null;
    let status = 'new → upload';
    let analyze = plan.analyze;
    if (cloudinary) {
      try {
        const existing = await existingResource(plan);
        if (existing && !force) {
          analyze = plan.analyze && hasTag(existing) && !hasAnalysis(existing);
          status = !hasTag(existing)
            ? `exists but not in the workspace (no "${tag}" tag) → skip (--force re-imports it)`
            : `exists → skip${analyze ? ', AI analysis missing → analyse' : ''}${metadataOn && !hasMetadata(existing) ? ', add structured metadata' : ''}`;
        } else if (existing) {
          status = 'exists → overwrite (--force)';
        }
      } catch (error) {
        status = `cannot check (${errorText(error, config)})`;
      }
    } else {
      status = `${online ? 'not checked (no credentials)' : 'not checked (--offline)'} → upload unless it exists`;
    }
    if (analyze) wouldDetect += 2;
    const size = probe ? (probe.ok ? `${kb(probe.bytes)} ${probe.type.split(';')[0]}` : `✗ HTTP ${probe.status} ${probe.error}`) : '';
    const tooBig = probe?.bytes && probe.bytes > MAX_SOURCE_BYTES ? ' ✗ over the 40 MB limit' : '';
    console.log(`${pad(plan.id, 22)} ${pad(plan.resourceType, 5)} → ${plan.publicId}`);
    console.log(`  source    ${plan.source}${size ? `  (${size}${tooBig})` : ''}`);
    console.log(`  tags      ${plan.tags.join(', ')}`);
    console.log(`  context   ${Object.keys(plan.context).join(', ')}`);
    console.log(`            provenance=${plan.context[CTX.provenance]} · ${plan.context[CTX.sampleHoursAgo] !== undefined ? `sample_hours_ago=${plan.context[CTX.sampleHoursAgo]}` : `captured_at=${plan.context[CTX.capturedAt]} · camera_time=${plan.context[CTX.cameraTime]}`}${plan.context[CTX.region] ? ` · region=${plan.context[CTX.region]}` : ''}`);
    const metadataText = Object.entries(plan.metadata).map(([k, v]) => `${k}=${v}`).join(' · ');
    console.log(`  metadata  ${metadataText}${metadataOn ? '' : metadataChecked ? '  (not written: fields missing)' : '  (written only if the fields exist)'}`);
    console.log(`  AI        ${analyze ? 'captioning, then coco_v2 + auto_tagging 0.5 (2 detections)' : plan.resourceType === 'video' ? 'none (video: poster-frame signals come from fl_getinfo)' : 'none'}`);
    console.log(`  status    ${status}\n`);
  }
  console.log(`Dry run: ${plans.length} records planned, up to ${wouldDetect} AI detections. No changes were made.`);
  process.exit(0);
}

/* ---- import ------------------------------------------------------------------ */

let detections = 0;
const outcome = { uploaded: 0, skipped: 0, analysed: 0, failed: 0 };

/**
 * Cloudinary AI Content Analysis on one image: captioning, then COCO object detection with auto-tagging.
 * AI tags are the tags auto-tagging added (anything beyond the record's own tags). The result is merged
 * into the context already on the asset (previous ai_* keys replaced).
 */
async function analyse(plan, width, height) {
  const options = { resource_type: 'image', timeout: API_TIMEOUT_MS };
  const problems = [];
  let captioned;
  let detected;
  try {
    detections += 1;
    captioned = await cloudinary.api.update(plan.publicId, { ...options, detection: 'captioning' });
  } catch (error) {
    problems.push(`captioning: ${errorText(error, config)}`);
  }
  try {
    detections += 1;
    detected = await cloudinary.api.update(plan.publicId, { ...options, detection: 'coco_v2', auto_tagging: 0.5 });
  } catch (error) {
    problems.push(`coco_v2: ${errorText(error, config)}`);
  }
  if (!captioned && !detected) throw new Error(problems.join('; '));

  const d1 = captioned?.info?.detection ?? {};
  const d2 = detected?.info?.detection ?? {};
  const ai = parseDetection(
    { captioning: d2.captioning ?? d1.captioning, object_detection: d2.object_detection ?? d1.object_detection },
    width,
    height,
  );
  const own = new Set(plan.tags);
  ai.tags = (detected?.tags ?? []).filter((t) => !own.has(t));
  ai.analyzedAt = new Date().toISOString();

  // Merge: read the context on the asset now, drop earlier AI keys, add the new ones.
  const current = await cloudinary.api.resource(plan.publicId, options);
  const base = Object.fromEntries(
    Object.entries(current?.context?.custom ?? {}).filter(([k, v]) => typeof v === 'string' && !AI_KEYS.includes(k)),
  );
  await cloudinary.api.update(plan.publicId, { ...options, context: { ...base, ...encodeAiContext(ai) } });
  return { ai, problems };
}

for (const plan of plans) {
  const label = `${pad(plan.id, 22)} ${pad(plan.resourceType, 5)}`;
  try {
    const existing = await existingResource(plan);
    let resource = existing;
    let action;

    if (existing && !force) {
      outcome.skipped += 1;
      if (!hasTag(existing)) {
        console.log(`– ${label} ${pad(kb(existing.bytes), 9)} exists, not in the workspace (no "${tag}" tag): skipped — --force re-imports it`);
        continue;
      }
      action = 'exists';
      if (metadataOn && !hasMetadata(existing)) {
        await cloudinary.api.update(plan.publicId, { resource_type: plan.resourceType, metadata: plan.metadata, timeout: API_TIMEOUT_MS });
        action += ' · metadata added';
      }
      if (!(plan.analyze && !hasAnalysis(existing))) {
        const caption = existing.context?.custom?.[CTX.aiCaption];
        console.log(`– ${label} ${pad(kb(existing.bytes), 9)} ${action}: skipped${caption ? ` · AI "${short(caption)}"` : ''}`);
        continue;
      }
    } else {
      if (plan.resourceType === 'video') {
        // The rendition is made on demand by the demo cloud: wait for it, and keep within the size limit.
        const probe = await probeSource(plan.source, { waitMs: 180_000 });
        if (!probe.ok) throw new Error(`source not available (HTTP ${probe.status}${probe.error ? ` ${probe.error}` : ''})`);
        if (probe.bytes && probe.bytes > MAX_SOURCE_BYTES) throw new Error(`source is ${kb(probe.bytes)}, over the 40 MB limit`);
      }
      resource = await cloudinary.uploader.upload(plan.source, {
        public_id: plan.publicId,
        resource_type: plan.resourceType,
        type: 'upload',
        overwrite: force,
        invalidate: force,
        tags: plan.tags,
        context: plan.context,
        ...(metadataOn ? { metadata: plan.metadata } : {}),
        timeout: UPLOAD_TIMEOUT_MS,
      });
      outcome.uploaded += 1;
      action = existing ? 'overwritten' : 'uploaded';
    }

    let aiNote = '';
    if (plan.analyze) {
      try {
        const { ai, problems } = await analyse(plan, resource.width, resource.height);
        outcome.analysed += 1;
        aiNote = ai.caption
          ? ` · AI "${short(ai.caption)}"`
          : ` · AI ${ai.objects.length} object${ai.objects.length === 1 ? '' : 's'}, no caption`;
        if (problems.length) aiNote += ` (partial: ${problems.join('; ')})`;
      } catch (error) {
        outcome.failed += 1;
        aiNote = ` · ✗ AI failed: ${error.message}`;
      }
    }
    console.log(`✓ ${label} ${pad(kb(resource.bytes), 9)} ${action}${aiNote}`);
  } catch (error) {
    outcome.failed += 1;
    console.log(`✗ ${label} ${errorText(error, config)}`);
  }
}

console.log(
  `\n${outcome.uploaded} uploaded · ${outcome.skipped} already there · ${outcome.analysed} analysed · ` +
    `${detections} AI detection${detections === 1 ? '' : 's'} requested${outcome.failed ? ` · ${outcome.failed} failed` : ''}.`,
);
if (!outcome.failed) console.log(`Open /console: with the server configured it now runs on the "${tag}" records in your cloud.`);
process.exit(outcome.failed ? 1 : 0);
