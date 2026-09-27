#!/usr/bin/env node
/**
 * Creates the VisualOps structured metadata fields on the team's Cloudinary cloud (Admin API).
 *
 *   vo_category  enum    structural · safety · equipment · electrical · facilities · inventory
 *   vo_severity  enum    critical · high · medium · low
 *   vo_status    enum    open · monitoring · resolved
 *   vo_site      string  (at most 60 characters)
 *
 * Idempotent: a field that already exists is left alone (a missing or deactivated enum value is added or
 * restored; a field with the same external id but another type is reported, never changed). Finishes by
 * listing the fields again and checking all four are ready. Once they are, the signing route
 * (POST /api/cloudinary/sign) adds structured metadata to every upload and GET /api/cloudinary/config
 * reports `structuredMetadata: true` (the server re-checks within a minute).
 *
 * Usage:  npm run setup:cloudinary              create what is missing
 *         npm run setup:cloudinary -- --dry-run  only show what would be created (reads, no writes)
 *
 * Credentials: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET from the environment or
 * .env.local. Only variable names and field names are printed, never values.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cloudinaryClient,
  errorText,
  loadCredentials,
  metadataFieldDefinition,
  metadataFieldStates,
  printCredentialStatus,
} from './lib/cloudinary-admin.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const unknown = args.filter((a) => a !== '--dry-run');
if (unknown.length) {
  console.error(`Unknown option ${unknown.join(' ')}. Usage: npm run setup:cloudinary [-- --dry-run]`);
  process.exit(2);
}

console.log(`VisualOps · structured metadata setup${dryRun ? ' (dry run: no writes)' : ''}\n`);
const creds = loadCredentials(root);
printCredentialStatus(creds);
if (!creds.config) {
  console.error(`\nMissing or invalid: ${creds.missing.join(', ')}. Add them to .env.local (see .env.example).`);
  process.exit(1);
}
const { config } = creds;
const cloudinary = cloudinaryClient(require('cloudinary').v2, config);

async function listFields() {
  const result = await cloudinary.api.list_metadata_fields();
  return result?.metadata_fields ?? [];
}

let listed;
try {
  listed = await listFields();
} catch (error) {
  console.error(`\n✗ Could not list the metadata fields: ${errorText(error, config)}`);
  process.exit(1);
}

console.log('\nFields:');
let problems = 0;
let writes = 0;
for (const state of metadataFieldStates(listed)) {
  const { field } = state;
  const name = field.external_id.padEnd(12);
  try {
    if (state.state === 'ready') {
      console.log(`  ✓ ${name} exists (${field.type})`);
    } else if (state.state === 'wrong-type') {
      problems += 1;
      console.log(
        `  ✗ ${name} exists with type "${state.existing.type}", expected "${field.type}". ` +
          'Rename or remove that field in the Cloudinary console (Manage → Structured metadata), then run this again.',
      );
    } else if (state.state === 'missing') {
      if (dryRun) {
        console.log(`  · ${name} would be created (${field.type}${field.values.length ? `: ${field.values.join(', ')}` : ''})`);
      } else {
        await cloudinary.api.add_metadata_field(metadataFieldDefinition(field));
        writes += 1;
        console.log(`  + ${name} created (${field.type}${field.values.length ? `: ${field.values.join(', ')}` : ''})`);
      }
    } else {
      // An enum that exists but lacks (or has deactivated) some of the VisualOps values.
      const parts = [];
      const done = [];
      if (state.missingValues.length) {
        parts.push(`add ${state.missingValues.join(', ')}`);
        done.push(`added ${state.missingValues.join(', ')}`);
      }
      if (state.inactiveValues.length) {
        parts.push(`restore ${state.inactiveValues.join(', ')}`);
        done.push(`restored ${state.inactiveValues.join(', ')}`);
      }
      if (dryRun) {
        console.log(`  · ${name} exists; would ${parts.join('; ')}`);
      } else {
        if (state.missingValues.length) {
          await cloudinary.api.update_metadata_field_datasource(field.external_id, {
            values: state.missingValues.map((v) => ({ external_id: v, value: v })),
          });
          writes += 1;
        }
        if (state.inactiveValues.length) {
          await cloudinary.api.restore_metadata_field_datasource(field.external_id, state.inactiveValues);
          writes += 1;
        }
        console.log(`  + ${name} exists; ${done.join('; ')}`);
      }
    }
  } catch (error) {
    problems += 1;
    console.log(`  ✗ ${name} ${errorText(error, config)}`);
  }
}

if (dryRun) {
  const pending = metadataFieldStates(listed).filter((s) => s.state !== 'ready').length;
  console.log(`\nDry run: ${pending ? `${pending} field${pending === 1 ? '' : 's'} to create or complete` : 'nothing to do'}. No changes were made.`);
  process.exit(problems ? 1 : 0);
}

// Verify: list again and require all four.
let after;
try {
  after = metadataFieldStates(await listFields());
} catch (error) {
  console.error(`\n✗ Could not list the metadata fields to verify: ${errorText(error, config)}`);
  process.exit(1);
}
const notReady = after.filter((s) => s.state !== 'ready');
if (notReady.length) {
  console.error(`\n✗ Not ready: ${notReady.map((s) => `${s.field.external_id} (${s.state})`).join(', ')}.`);
  process.exit(1);
}
console.log(
  `\n✓ Structured metadata ready: ${after.map((s) => s.field.external_id).join(', ')}` +
    `${writes ? ` (${writes} change${writes === 1 ? '' : 's'})` : ' (already set up)'}.` +
    '\n  New uploads carry it from the next signature (the server re-checks within a minute).',
);
process.exit(problems ? 1 : 0);
