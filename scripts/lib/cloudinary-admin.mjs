/**
 * Shared by scripts/setup-cloudinary.mjs and scripts/seed-cloudinary.mjs.
 *
 * Credentials come from the process environment or from .env.local (the same variables the Next.js
 * server reads; the process environment wins, as it does in Next.js). Values are never printed: status
 * lines name the variables only, and every error message is scrubbed of the API key and secret.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/i;
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,62}$/i;

/** KEY=VALUE lines of a dotenv file (comments, blank lines and malformed lines ignored). Values are not logged. */
export function readEnvFile(path) {
  if (!existsSync(path)) return null;
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '').trim();
    out[m[1]] = value;
  }
  return out;
}

/**
 * Resolves the server credentials exactly like src/lib/server/cloudinary.ts does.
 * Returns { config, status, missing, envFile } where `config` is null when anything required is missing.
 */
export function loadCredentials(root) {
  const envFile = join(root, '.env.local');
  const file = readEnvFile(envFile) ?? {};
  const get = (name) => {
    const fromProcess = process.env[name]?.trim();
    if (fromProcess) return { value: fromProcess, from: 'environment' };
    const fromFile = file[name]?.trim();
    return fromFile ? { value: fromFile, from: '.env.local' } : { value: undefined, from: null };
  };
  const cloudName = get('CLOUDINARY_CLOUD_NAME').value ? get('CLOUDINARY_CLOUD_NAME') : get('NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME');
  const apiKey = get('CLOUDINARY_API_KEY');
  const apiSecret = get('CLOUDINARY_API_SECRET');
  const tagVar = get('VISUALOPS_TAG').value ? get('VISUALOPS_TAG') : get('NEXT_PUBLIC_VISUALOPS_TAG');

  const status = [
    ['CLOUDINARY_CLOUD_NAME', cloudName.value ? (NAME_PATTERN.test(cloudName.value) ? `set (${cloudName.from})` : 'invalid') : 'missing'],
    ['CLOUDINARY_API_KEY', apiKey.value ? `set (${apiKey.from})` : 'missing'],
    ['CLOUDINARY_API_SECRET', apiSecret.value ? `set (${apiSecret.from})` : 'missing'],
    ['VISUALOPS_TAG', tagVar.value ? (TAG_PATTERN.test(tagVar.value) ? `set (${tagVar.from})` : 'invalid, using default') : 'default'],
  ];
  const missing = status.filter(([name, s]) => name !== 'VISUALOPS_TAG' && (s === 'missing' || s === 'invalid')).map(([name]) => name);
  const tag = tagVar.value && TAG_PATTERN.test(tagVar.value) ? tagVar.value : 'visualops';
  const config = missing.length
    ? null
    : { cloudName: cloudName.value, apiKey: apiKey.value, apiSecret: apiSecret.value, tag };
  return { config, status, missing, envFile: existsSync(envFile) ? '.env.local' : null, tag };
}

/** Prints which variables are set — names and status only, never values. */
export function printCredentialStatus({ status, envFile }) {
  console.log(`Credentials${envFile ? ' (process environment, then .env.local)' : ' (process environment; no .env.local found)'}:`);
  for (const [name, s] of status) console.log(`  ${s.startsWith('set') || s === 'default' ? '✓' : '✗'} ${name}  ${s}`);
}

/** Configures and returns the Cloudinary Node SDK (v2). */
export function cloudinaryClient(cloudinary, config) {
  cloudinary.config({ cloud_name: config.cloudName, api_key: config.apiKey, api_secret: config.apiSecret, secure: true });
  return cloudinary;
}

/** A printable message for a Cloudinary SDK error, with the API key and secret scrubbed out. */
export function errorText(error, config) {
  const e = error ?? {};
  const code = e.error?.http_code ?? e.http_code;
  let message = String(e.error?.message ?? e.message ?? e);
  message = message.replace(/api_secret[^,;\s]*/gi, 'api_secret=[redacted]');
  for (const secret of [config?.apiSecret, config?.apiKey]) {
    if (secret && secret.length >= 6) message = message.split(secret).join('[redacted]');
  }
  return code ? `${message} (HTTP ${code})` : message;
}

/** HTTP status of a Cloudinary SDK error, when it has one. */
export function errorStatus(error) {
  return error?.error?.http_code ?? error?.http_code;
}

/* -------------------------------------------------------------------------- */
/* Structured metadata fields                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The VisualOps structured metadata fields. Keep in sync with STRUCTURED_METADATA_FIELDS in
 * src/lib/server/cloudinary.ts (the signing route writes them only when all four exist).
 * Enum datasource entries use the value itself as both external_id and display value.
 */
export const METADATA_FIELDS = [
  {
    external_id: 'vo_category',
    label: 'VisualOps category',
    type: 'enum',
    values: ['structural', 'safety', 'equipment', 'electrical', 'facilities', 'inventory'],
  },
  { external_id: 'vo_severity', label: 'VisualOps severity', type: 'enum', values: ['critical', 'high', 'medium', 'low'] },
  { external_id: 'vo_status', label: 'VisualOps status', type: 'enum', values: ['open', 'monitoring', 'resolved'] },
  { external_id: 'vo_site', label: 'VisualOps site', type: 'string', values: [], maxLength: 60 },
];

/** The Admin API definition (add_metadata_field) of one field. */
export function metadataFieldDefinition(field) {
  const base = { external_id: field.external_id, label: field.label, type: field.type, mandatory: false };
  if (field.type === 'enum') {
    return { ...base, datasource: { values: field.values.map((v) => ({ external_id: v, value: v })) } };
  }
  return { ...base, validation: { type: 'strlen', max: field.maxLength } };
}

/**
 * Compares the listed fields with the VisualOps definitions.
 * Returns one entry per field: { field, state: 'missing' | 'wrong-type' | 'incomplete' | 'ready', existing,
 * missingValues, inactiveValues }.
 */
export function metadataFieldStates(listed) {
  const fields = Array.isArray(listed) ? listed : [];
  return METADATA_FIELDS.map((field) => {
    const existing = fields.find((f) => f?.external_id === field.external_id);
    if (!existing) return { field, state: 'missing', missingValues: field.values, inactiveValues: [] };
    if (existing.type !== field.type) return { field, state: 'wrong-type', existing, missingValues: [], inactiveValues: [] };
    const entries = Array.isArray(existing.datasource?.values) ? existing.datasource.values : [];
    const active = new Set(entries.filter((v) => v?.state !== 'inactive').map((v) => v?.external_id));
    const known = new Set(entries.map((v) => v?.external_id));
    const missingValues = field.values.filter((v) => !known.has(v));
    const inactiveValues = field.values.filter((v) => known.has(v) && !active.has(v));
    const state = missingValues.length || inactiveValues.length ? 'incomplete' : 'ready';
    return { field, state, existing, missingValues, inactiveValues };
  });
}

/** True when every VisualOps field exists with the right type and every enum value is active. */
export function metadataReady(listed) {
  return metadataFieldStates(listed).every((s) => s.state === 'ready');
}
