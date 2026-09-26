import type { MediaAsset, ResourceType } from '@/lib/types';
import { isoDay } from '@/lib/format';
import {
  component,
  deliveryUrl,
  encodeOverlayText,
  encodePrompt,
  sanitizeColor,
} from './url';
import { refOf } from './media';

/**
 * The Visual AI Pipeline: an ordered list of steps, each of which maps to one
 * Cloudinary transformation component. The URL that renders in the Studio is
 * exactly the URL that is exported.
 */

export type StepKind =
  | 'smart_crop'
  | 'resize'
  | 'improve'
  | 'sharpen'
  | 'privacy_faces'
  | 'text_stamp'
  | 'remove_background'
  | 'enhance'
  | 'gen_background_replace'
  | 'gen_fill'
  | 'gen_replace'
  | 'gen_recolor'
  | 'gen_remove'
  | 'gen_restore'
  | 'upscale'
  | 'trim'
  | 'smart_reframe'
  | 'ai_preview'
  | 'auto_quality'
  | 'auto_format';

/**
 * Evidence integrity of a step:
 * - `evidence`: no content is invented (crop, resize, exposure, redaction, stamps, delivery).
 * - `ai-edit`: AI removes or selects content without inventing it.
 * - `generative`: new pixels are synthesised; never admissible as evidence.
 */
export type Integrity = 'evidence' | 'ai-edit' | 'generative';

export type StepGroup = 'Frame' | 'Correct' | 'Privacy' | 'Annotate' | 'AI edit' | 'Generative' | 'Video' | 'Delivery';

export type StepParams = Record<string, string | number | boolean>;

export interface PipelineStep {
  id: string;
  kind: StepKind;
  enabled: boolean;
  params: StepParams;
}

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDef {
  key: string;
  label: string;
  type: 'select' | 'text' | 'number' | 'color' | 'toggle';
  options?: FieldOption[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  help?: string;
}

export interface BuildContext {
  asset: MediaAsset;
}

export interface StepDefinition {
  kind: StepKind;
  label: string;
  description: string;
  group: StepGroup;
  integrity: Integrity;
  appliesTo: ResourceType[];
  /** Cloudinary renders some AI transformations asynchronously (HTTP 423 until ready). */
  async?: boolean;
  /** Changes the frame geometry (crop, pad, trim) so before/after no longer align pixel-for-pixel. */
  changesGeometry?: boolean;
  defaults: StepParams;
  fields: FieldDef[];
  build: (params: StepParams, ctx: BuildContext) => string | null;
  /** Short human summary of the parameters, shown on the step card. */
  summarize?: (params: StepParams) => string;
}

const ASPECTS: FieldOption[] = [
  { value: '16:9', label: '16:9 · report / screen' },
  { value: '4:3', label: '4:3 · inspection sheet' },
  { value: '1:1', label: '1:1 · catalog / grid' },
  { value: '4:5', label: '4:5 · portrait feed' },
  { value: '9:16', label: '9:16 · vertical brief' },
];

const POSITIONS: FieldOption[] = [
  { value: 'south_west', label: 'Bottom left' },
  { value: 'south_east', label: 'Bottom right' },
  { value: 'north_west', label: 'Top left' },
  { value: 'north_east', label: 'Top right' },
];

export const str = (value: string | number | boolean | undefined, fallback = ''): string =>
  value === undefined ? fallback : String(value);

export const num = (value: string | number | boolean | undefined, fallback: number, min?: number, max?: number): number => {
  const n = typeof value === 'number' ? value : Number(value);
  let out = Number.isFinite(n) ? n : fallback;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return Math.round(out * 10) / 10;
};

const ASPECT_RE = /^\d{1,2}:\d{1,2}$/;
export const aspect = (value: string | number | boolean | undefined, fallback = '16:9') => {
  const v = str(value, fallback);
  return ASPECT_RE.test(v) ? v : fallback;
};

export const STAMP_POSITIONS = ['south_west', 'south_east', 'north_west', 'north_east'];

export function stampPosition(value: string | number | boolean | undefined): string {
  const v = str(value, 'south_west');
  return STAMP_POSITIONS.includes(v) ? v : 'south_west';
}

/**
 * The audit-stamp text layer. `encode: false` leaves the text readable for
 * APIs that URL-encode it themselves (next-cloudinary's rawTransformations).
 */
export function stampComponent(p: StepParams, asset: MediaAsset, encode: boolean): string | null {
  const text = expandStampText(str(p.text, '{id} · {severity} · {date}'), asset);
  if (!text) return null;
  return component({
    b: 'rgb:0B0C0E',
    co: 'rgb:FFFFFF',
    g: stampPosition(p.position),
    l: `text:Arial_${num(p.size, 28, 12, 96)}_bold:${encode ? encodeOverlayText(text) : text}`,
    x: 24,
    y: 24,
  });
}

/**
 * What `{date}` burns in for sample-dataset media. Their capture times are
 * synthetic (derived from the viewer's clock), so an audit stamp must not
 * present them as a real capture date.
 */
export const SAMPLE_STAMP_DATE = 'SAMPLE';

/** The capture day an audit stamp may burn in: the real day for uploads and synced media, `SAMPLE` for the sample dataset. */
export function stampDate(asset: MediaAsset): string {
  if (asset.source === 'sample') return SAMPLE_STAMP_DATE;
  const captured = new Date(asset.capturedAt);
  return Number.isNaN(captured.getTime()) ? 'UNDATED' : isoDay(captured);
}

/**
 * Replaces {id} {severity} {date} {site} {file} tokens in stamp text.
 * `{date}` is the capture day, or `SAMPLE` for sample-dataset media (see `stampDate`).
 */
export function expandStampText(template: string, asset: MediaAsset): string {
  const finding = asset.finding;
  return template
    .replace(/\{id\}/g, finding?.id ?? asset.id.toUpperCase())
    .replace(/\{severity\}/g, (finding?.severity ?? 'observation').toUpperCase())
    .replace(/\{date\}/g, stampDate(asset))
    .replace(/\{site\}/g, asset.site)
    .replace(/\{file\}/g, asset.fileName)
    .replace(/[,/]/g, ' ')
    .trim();
}

/**
 * Output width of a smart crop: the requested width, capped at the widest crop
 * of that aspect ratio the original contains, so `c_fill` only ever crops and
 * downscales — it never upscales. Shared by the URL builder and the code export
 * so both render the same single component.
 */
export function smartCropWidth(p: StepParams, asset: Pick<MediaAsset, 'width' | 'height'>): number {
  const requested = num(p.width, 1600, 200, 3200);
  const [aw, ah] = aspect(p.aspect).split(':').map(Number);
  const { width, height } = asset;
  if (!(width > 0 && height > 0 && aw > 0 && ah > 0)) return requested;
  const widest = Math.floor(Math.min(width, (height * aw) / ah));
  return Math.max(1, Math.min(requested, widest));
}

export const STEP_DEFINITIONS: Record<StepKind, StepDefinition> = {
  smart_crop: {
    kind: 'smart_crop',
    label: 'Smart crop',
    description: 'Crop to an aspect ratio; Cloudinary AI keeps the subject in frame (g_auto).',
    group: 'Frame',
    integrity: 'evidence',
    appliesTo: ['image'],
    changesGeometry: true,
    defaults: { aspect: '16:9', gravity: 'auto', width: 1600 },
    fields: [
      { key: 'aspect', label: 'Aspect ratio', type: 'select', options: ASPECTS },
      {
        key: 'gravity',
        label: 'Focus',
        type: 'select',
        options: [
          { value: 'auto', label: 'Auto subject (g_auto)' },
          { value: 'faces', label: 'Faces (g_faces)' },
          { value: 'center', label: 'Centre' },
        ],
      },
      {
        key: 'width',
        label: 'Max output width',
        type: 'number',
        min: 200,
        max: 3200,
        step: 100,
        help: 'Never upscales: capped at the widest crop the original supports.',
      },
    ],
    build: (p, ctx) =>
      component({
        ar: aspect(p.aspect),
        c: 'fill',
        g: str(p.gravity, 'auto').replace(/[^a-z:]/g, '') || 'auto',
        w: smartCropWidth(p, ctx.asset),
      }),
    summarize: (p) => `${aspect(p.aspect)} · g_${str(p.gravity, 'auto')} · ≤${num(p.width, 1600, 200, 3200)}px`,
  },
  resize: {
    kind: 'resize',
    label: 'Resize',
    description: 'Scale to a maximum width without cropping.',
    group: 'Frame',
    integrity: 'evidence',
    appliesTo: ['image', 'video'],
    defaults: { width: 960 },
    fields: [{ key: 'width', label: 'Max width', type: 'number', min: 160, max: 3840, step: 40 }],
    build: (p, ctx) =>
      component({ c: ctx.asset.resourceType === 'video' ? 'scale' : 'limit', w: num(p.width, 960, 160, 3840) }),
    summarize: (p) => `max ${num(p.width, 960)}px`,
  },
  improve: {
    kind: 'improve',
    label: 'Auto exposure',
    description: 'Balances colour, contrast and lighting (e_improve). No content is generated.',
    group: 'Correct',
    integrity: 'evidence',
    appliesTo: ['image'],
    defaults: { mode: 'auto' },
    fields: [
      {
        key: 'mode',
        label: 'Scene',
        type: 'select',
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'outdoor', label: 'Outdoor' },
          { value: 'indoor', label: 'Indoor' },
        ],
      },
    ],
    build: (p) => {
      const mode = str(p.mode, 'auto');
      return mode === 'outdoor' || mode === 'indoor' ? `e_improve:${mode}` : 'e_improve';
    },
    summarize: (p) => str(p.mode, 'auto'),
  },
  sharpen: {
    kind: 'sharpen',
    label: 'Sharpen',
    description: 'Recovers edge detail in soft field captures (e_sharpen).',
    group: 'Correct',
    integrity: 'evidence',
    appliesTo: ['image'],
    defaults: { strength: 60 },
    fields: [{ key: 'strength', label: 'Strength', type: 'number', min: 1, max: 400, step: 10 }],
    build: (p) => `e_sharpen:${num(p.strength, 60, 1, 400)}`,
    summarize: (p) => `strength ${num(p.strength, 60)}`,
  },
  privacy_faces: {
    kind: 'privacy_faces',
    label: 'Redact faces',
    description: 'Pixelates or blurs the faces Cloudinary detects before media is shared. Frames with no detections are unchanged.',
    group: 'Privacy',
    integrity: 'evidence',
    appliesTo: ['image'],
    defaults: { mode: 'pixelate', strength: 20 },
    fields: [
      {
        key: 'mode',
        label: 'Method',
        type: 'select',
        options: [
          { value: 'pixelate', label: 'Pixelate (e_pixelate_faces)' },
          { value: 'blur', label: 'Blur (e_blur_faces)' },
        ],
      },
      { key: 'strength', label: 'Strength', type: 'number', min: 1, max: 200, step: 1 },
    ],
    build: (p) =>
      str(p.mode) === 'blur'
        ? `e_blur_faces:${num(p.strength, 20, 1, 200) * 10}`
        : `e_pixelate_faces:${num(p.strength, 20, 1, 200)}`,
    summarize: (p) => `${str(p.mode, 'pixelate')} · ${num(p.strength, 20)}`,
  },
  text_stamp: {
    kind: 'text_stamp',
    label: 'Audit stamp',
    description: 'Burns a text overlay into the delivered media: finding ID, severity, date.',
    group: 'Annotate',
    integrity: 'evidence',
    appliesTo: ['image', 'video'],
    defaults: { text: '{id} · {severity} · {date}', position: 'south_west', size: 28 },
    fields: [
      {
        key: 'text',
        label: 'Text',
        type: 'text',
        placeholder: '{id} · {severity} · {date}',
        help: 'Tokens: {id} {severity} {date} {site} {file}. {date} reads SAMPLE on sample-dataset media.',
      },
      { key: 'position', label: 'Position', type: 'select', options: POSITIONS },
      { key: 'size', label: 'Size', type: 'number', min: 12, max: 96, step: 2 },
    ],
    build: (p, ctx) => stampComponent(p, ctx.asset, true),
    summarize: (p) => str(p.text, '{id} · {severity} · {date}'),
  },
  remove_background: {
    kind: 'remove_background',
    label: 'Remove background',
    description: 'Cloudinary AI isolates the subject — e.g. a vehicle or tool for an asset register.',
    group: 'AI edit',
    integrity: 'ai-edit',
    appliesTo: ['image'],
    defaults: {},
    fields: [],
    build: () => 'e_background_removal',
  },
  enhance: {
    kind: 'enhance',
    label: 'AI enhance',
    description: 'AI-driven tone and colour adjustment (e_enhance).',
    group: 'AI edit',
    integrity: 'ai-edit',
    appliesTo: ['image'],
    defaults: {},
    fields: [],
    build: () => 'e_enhance',
  },
  gen_background_replace: {
    kind: 'gen_background_replace',
    label: 'Generative background',
    description: 'Replaces the background from a text prompt (e_gen_background_replace).',
    group: 'Generative',
    integrity: 'generative',
    appliesTo: ['image'],
    defaults: { prompt: 'clean concrete depot floor in soft overcast daylight' },
    fields: [{ key: 'prompt', label: 'Prompt', type: 'text', placeholder: 'Describe the new background' }],
    build: (p) => {
      const prompt = encodePrompt(str(p.prompt));
      return prompt ? `e_gen_background_replace:prompt_${prompt}` : 'e_gen_background_replace';
    },
    summarize: (p) => `“${str(p.prompt)}”`,
  },
  gen_fill: {
    kind: 'gen_fill',
    label: 'Generative fill',
    description: 'Extends the canvas to a new aspect ratio with AI-generated pixels (b_gen_fill).',
    group: 'Generative',
    integrity: 'generative',
    appliesTo: ['image'],
    changesGeometry: true,
    defaults: { aspect: '16:9', width: 1600, prompt: '' },
    fields: [
      { key: 'aspect', label: 'Aspect ratio', type: 'select', options: ASPECTS },
      { key: 'width', label: 'Output width', type: 'number', min: 200, max: 3200, step: 100 },
      { key: 'prompt', label: 'Prompt (optional)', type: 'text', placeholder: 'Guide the fill' },
    ],
    build: (p) => {
      const prompt = encodePrompt(str(p.prompt));
      return component({
        ar: aspect(p.aspect),
        b: prompt ? `gen_fill:prompt_${prompt}` : 'gen_fill',
        c: 'pad',
        w: num(p.width, 1600, 200, 3200),
      });
    },
    summarize: (p) => `${aspect(p.aspect)}${str(p.prompt) ? ` · “${str(p.prompt)}”` : ''}`,
  },
  gen_replace: {
    kind: 'gen_replace',
    label: 'Generative replace',
    description: 'Swaps one object for another described in words (e_gen_replace).',
    group: 'Generative',
    integrity: 'generative',
    appliesTo: ['image'],
    defaults: { from: 'mop', to: 'yellow wet floor warning sign', preserveGeometry: false },
    fields: [
      { key: 'from', label: 'Replace', type: 'text', placeholder: 'object to replace' },
      { key: 'to', label: 'With', type: 'text', placeholder: 'replacement' },
      { key: 'preserveGeometry', label: 'Preserve shape', type: 'toggle' },
    ],
    build: (p) => {
      const from = encodePrompt(str(p.from));
      const to = encodePrompt(str(p.to));
      if (!from || !to) return null;
      return `e_gen_replace:from_${from};to_${to}${p.preserveGeometry === true ? ';preserve-geometry_true' : ''}`;
    },
    summarize: (p) => `${str(p.from)} → ${str(p.to)}`,
  },
  gen_recolor: {
    kind: 'gen_recolor',
    label: 'Generative recolor',
    description: 'Recolours a described object while keeping its shading (e_gen_recolor).',
    group: 'Generative',
    integrity: 'generative',
    appliesTo: ['image'],
    defaults: { prompt: 'hard hat', color: 'FF6A00' },
    fields: [
      { key: 'prompt', label: 'Object', type: 'text', placeholder: 'what to recolour' },
      { key: 'color', label: 'Colour', type: 'color' },
    ],
    build: (p) => {
      const prompt = encodePrompt(str(p.prompt));
      if (!prompt) return null;
      return `e_gen_recolor:prompt_${prompt};to-color_${sanitizeColor(str(p.color), 'FF6A00')}`;
    },
    summarize: (p) => `${str(p.prompt)} → #${sanitizeColor(str(p.color), 'FF6A00')}`,
  },
  gen_remove: {
    kind: 'gen_remove',
    label: 'Generative remove',
    description: 'Removes a described object and fills the gap (e_gen_remove).',
    group: 'Generative',
    integrity: 'generative',
    appliesTo: ['image'],
    defaults: { prompt: 'mop bucket' },
    fields: [{ key: 'prompt', label: 'Remove', type: 'text', placeholder: 'object to remove' }],
    build: (p) => {
      const prompt = encodePrompt(str(p.prompt));
      return prompt ? `e_gen_remove:prompt_${prompt}` : null;
    },
    summarize: (p) => `“${str(p.prompt)}”`,
  },
  gen_restore: {
    kind: 'gen_restore',
    label: 'Generative restore',
    description: 'Repairs compression artefacts and noise in degraded captures (e_gen_restore).',
    group: 'Generative',
    integrity: 'generative',
    appliesTo: ['image'],
    defaults: {},
    fields: [],
    build: () => 'e_gen_restore',
  },
  upscale: {
    kind: 'upscale',
    label: 'AI upscale',
    description: 'Super-resolution for low-resolution photos (e_upscale).',
    group: 'Generative',
    integrity: 'generative',
    appliesTo: ['image'],
    defaults: {},
    fields: [],
    build: () => 'e_upscale',
  },
  trim: {
    kind: 'trim',
    label: 'Trim',
    description: 'Keeps only the relevant segment of a clip (so_ / du_).',
    group: 'Video',
    integrity: 'evidence',
    appliesTo: ['video'],
    changesGeometry: true,
    defaults: { start: 0, duration: 8 },
    fields: [
      { key: 'start', label: 'Start (s)', type: 'number', min: 0, max: 600, step: 0.5 },
      { key: 'duration', label: 'Duration (s)', type: 'number', min: 1, max: 120, step: 0.5 },
    ],
    build: (p) => component({ du: num(p.duration, 8, 1, 120), so: num(p.start, 0, 0, 600) }),
    summarize: (p) => `${num(p.start, 0)}s + ${num(p.duration, 8)}s`,
  },
  smart_reframe: {
    kind: 'smart_reframe',
    label: 'AI reframe',
    description: 'Crops video to a new aspect ratio while tracking the subject (g_auto).',
    group: 'Video',
    integrity: 'evidence',
    appliesTo: ['video'],
    async: true,
    changesGeometry: true,
    defaults: { aspect: '9:16' },
    fields: [{ key: 'aspect', label: 'Aspect ratio', type: 'select', options: ASPECTS }],
    build: (p) => component({ ar: aspect(p.aspect, '9:16'), c: 'fill', g: 'auto' }),
    summarize: (p) => aspect(p.aspect, '9:16'),
  },
  ai_preview: {
    kind: 'ai_preview',
    label: 'AI highlights',
    description: 'Cloudinary AI selects the most relevant moments into a short preview (e_preview).',
    group: 'Video',
    integrity: 'ai-edit',
    appliesTo: ['video'],
    async: true,
    changesGeometry: true,
    defaults: { duration: 6 },
    fields: [{ key: 'duration', label: 'Length (s)', type: 'number', min: 2, max: 30, step: 1 }],
    build: (p) => `e_preview:duration_${num(p.duration, 6, 2, 30)}`,
    summarize: (p) => `${num(p.duration, 6)}s`,
  },
  auto_quality: {
    kind: 'auto_quality',
    label: 'Auto quality',
    description: 'Cloudinary picks the lowest file size with no visible quality loss (q_auto).',
    group: 'Delivery',
    integrity: 'evidence',
    appliesTo: ['image', 'video'],
    defaults: { level: 'auto' },
    fields: [
      {
        key: 'level',
        label: 'Level',
        type: 'select',
        options: [
          { value: 'auto', label: 'q_auto' },
          { value: 'auto:best', label: 'q_auto:best' },
          { value: 'auto:good', label: 'q_auto:good' },
          { value: 'auto:eco', label: 'q_auto:eco' },
        ],
      },
    ],
    build: (p) => {
      const level = str(p.level, 'auto');
      return ['auto', 'auto:best', 'auto:good', 'auto:eco'].includes(level) ? `q_${level}` : 'q_auto';
    },
    summarize: (p) => `q_${str(p.level, 'auto')}`,
  },
  auto_format: {
    kind: 'auto_format',
    label: 'Auto format',
    description: 'Serves AVIF, WebP or JPEG per browser for images; best codec for video.',
    group: 'Delivery',
    integrity: 'evidence',
    appliesTo: ['image', 'video'],
    defaults: {},
    fields: [],
    build: (_p, ctx) => (ctx.asset.resourceType === 'video' ? 'vc_auto' : 'f_auto'),
  },
};

export const STEP_ORDER: StepKind[] = [
  'smart_crop',
  'resize',
  'improve',
  'sharpen',
  'privacy_faces',
  'text_stamp',
  'remove_background',
  'enhance',
  'gen_background_replace',
  'gen_fill',
  'gen_replace',
  'gen_recolor',
  'gen_remove',
  'gen_restore',
  'upscale',
  'trim',
  'smart_reframe',
  'ai_preview',
  'auto_quality',
  'auto_format',
];

let stepCounter = 0;
export function newStepId(): string {
  stepCounter += 1;
  return `s${Date.now().toString(36)}${stepCounter}`;
}

export function createStep(kind: StepKind, params: StepParams = {}): PipelineStep {
  return {
    id: newStepId(),
    kind,
    enabled: true,
    params: { ...STEP_DEFINITIONS[kind].defaults, ...params },
  };
}

export function stepsFor(resourceType: ResourceType): StepDefinition[] {
  return STEP_ORDER.map((k) => STEP_DEFINITIONS[k]).filter((d) => d.appliesTo.includes(resourceType));
}

/** Transformation components for the enabled, applicable steps, in order. */
export function pipelineComponents(steps: PipelineStep[], asset: MediaAsset, upTo?: number): string[] {
  const slice = upTo === undefined ? steps : steps.slice(0, upTo + 1);
  return slice
    .filter((s) => s.enabled && STEP_DEFINITIONS[s.kind].appliesTo.includes(asset.resourceType))
    .map((s) => STEP_DEFINITIONS[s.kind].build(s.params, { asset }))
    .filter((c): c is string => Boolean(c));
}

/** Output extension: video renders as MP4; images keep their public ID untouched (format via f_auto). */
export function pipelineExtension(asset: MediaAsset): string | undefined {
  return asset.resourceType === 'video' ? 'mp4' : undefined;
}

export function pipelineUrl(steps: PipelineStep[], asset: MediaAsset, upTo?: number): string {
  return deliveryUrl(refOf(asset), pipelineComponents(steps, asset, upTo), pipelineExtension(asset));
}

export function pipelineIntegrity(steps: PipelineStep[], asset: MediaAsset): Integrity {
  const active = steps.filter((s) => s.enabled && STEP_DEFINITIONS[s.kind].appliesTo.includes(asset.resourceType));
  if (active.some((s) => STEP_DEFINITIONS[s.kind].integrity === 'generative')) return 'generative';
  if (active.some((s) => STEP_DEFINITIONS[s.kind].integrity === 'ai-edit')) return 'ai-edit';
  return 'evidence';
}

export function pipelineChangesGeometry(steps: PipelineStep[], asset: MediaAsset): boolean {
  return steps.some(
    (s) =>
      s.enabled &&
      STEP_DEFINITIONS[s.kind].appliesTo.includes(asset.resourceType) &&
      STEP_DEFINITIONS[s.kind].changesGeometry,
  );
}

export function pipelineIsAsync(steps: PipelineStep[], asset: MediaAsset): boolean {
  return steps.some(
    (s) => s.enabled && STEP_DEFINITIONS[s.kind].appliesTo.includes(asset.resourceType) && STEP_DEFINITIONS[s.kind].async,
  );
}

const FRAMING: StepKind[] = ['smart_crop', 'resize'];

/**
 * The "before" for a comparison: the original with only the pipeline's framing
 * (crop / resize) applied — original format and quality — so a before/after
 * slider compares processing, not framing.
 */
export function framingUrl(steps: PipelineStep[], asset: MediaAsset): string {
  const framing = steps.filter((s) => s.enabled && FRAMING.includes(s.kind) && STEP_DEFINITIONS[s.kind].appliesTo.includes(asset.resourceType));
  if (!framing.length) {
    return deliveryUrl(refOf(asset), [component({ c: 'limit', w: 2000 })]);
  }
  return deliveryUrl(
    refOf(asset),
    framing.map((s) => STEP_DEFINITIONS[s.kind].build(s.params, { asset })).filter((c): c is string => Boolean(c)),
  );
}

/** True when before/after share geometry after framing (no canvas extension). */
export function pipelineAligned(steps: PipelineStep[], asset: MediaAsset): boolean {
  return !steps.some((s) => s.enabled && s.kind === 'gen_fill' && STEP_DEFINITIONS[s.kind].appliesTo.includes(asset.resourceType));
}

export function hasFraming(steps: PipelineStep[]): boolean {
  return steps.some((s) => s.enabled && FRAMING.includes(s.kind));
}

export const INTEGRITY_LABEL: Record<Integrity, string> = {
  evidence: 'Evidence-safe',
  'ai-edit': 'AI edit',
  generative: 'Generative',
};

export const INTEGRITY_HELP: Record<Integrity, string> = {
  evidence: 'No content is invented. Suitable for inspection records and reports.',
  'ai-edit': 'AI removed or selected content. Label it when sharing; keep the original as the record.',
  generative: 'Contains AI-generated pixels. Use for previews and communication only — never as evidence.',
};

/* ------------------------------------------------------------------------ */
/* Presets                                                                   */
/* ------------------------------------------------------------------------ */

export interface PresetStep {
  kind: StepKind;
  params?: StepParams;
}

export interface PipelinePreset {
  id: string;
  name: string;
  description: string;
  resourceType: ResourceType;
  steps: PresetStep[];
  /** Asset IDs this preset is designed for (shown first when picking). */
  suggestedFor?: string[];
  audience: 'operations' | 'general';
}

export const PRESETS: PipelinePreset[] = [
  {
    id: 'evidence-enhance',
    name: 'Evidence enhance',
    description: 'Smart crop, exposure and sharpening — nothing generated. The default for inspection records.',
    resourceType: 'image',
    audience: 'operations',
    steps: [
      { kind: 'smart_crop', params: { aspect: '16:9', gravity: 'auto', width: 1600 } },
      { kind: 'improve' },
      { kind: 'sharpen', params: { strength: 60 } },
      { kind: 'auto_quality' },
      { kind: 'auto_format' },
    ],
  },
  {
    id: 'privacy-redaction',
    name: 'Privacy redaction',
    description: 'Pixelates the faces Cloudinary detects before media leaves the team.',
    resourceType: 'image',
    audience: 'operations',
    // Only where Cloudinary actually detects faces (fl_getinfo); the fleet check-in frame returns none.
    suggestedFor: ['vo-crew-ppe'],
    steps: [
      { kind: 'privacy_faces', params: { mode: 'pixelate', strength: 20 } },
      { kind: 'resize', params: { width: 1600 } },
      { kind: 'auto_quality' },
      { kind: 'auto_format' },
    ],
  },
  {
    id: 'audit-stamp',
    name: 'Audit stamp',
    description: 'Report-ready frame with the finding ID, severity and capture date burned in (SAMPLE on sample-dataset media).',
    resourceType: 'image',
    audience: 'operations',
    steps: [
      { kind: 'smart_crop', params: { aspect: '16:9', gravity: 'auto', width: 1600 } },
      { kind: 'improve' },
      { kind: 'text_stamp', params: { text: '{id} · {severity} · {date}', position: 'south_west', size: 30 } },
      { kind: 'auto_quality' },
      { kind: 'auto_format' },
    ],
  },
  {
    id: 'low-res-recovery',
    name: 'Low-res recovery',
    description: 'Generative restore and AI upscale for unusable captures. Output is marked generative.',
    resourceType: 'image',
    audience: 'operations',
    suggestedFor: ['vo-tool-crib', 'vo-wet-floor'],
    steps: [{ kind: 'gen_restore' }, { kind: 'upscale' }, { kind: 'auto_quality' }, { kind: 'auto_format' }],
  },
  {
    id: 'asset-register-cutout',
    name: 'Asset register cutout',
    description: 'Background removed for a clean equipment or fleet register entry.',
    resourceType: 'image',
    audience: 'operations',
    suggestedFor: ['vo-fleet-checkin', 'vo-tool-crib'],
    steps: [{ kind: 'remove_background' }, { kind: 'resize', params: { width: 1200 } }, { kind: 'auto_format' }],
  },
  {
    id: 'remediation-preview',
    name: 'Remediation preview',
    description: 'Visualises the corrective action with generative replace — for briefings, never as evidence.',
    resourceType: 'image',
    audience: 'operations',
    suggestedFor: ['vo-wet-floor'],
    steps: [
      { kind: 'gen_replace', params: { from: 'mop', to: 'yellow wet floor warning sign', preserveGeometry: false } },
      { kind: 'auto_quality' },
      { kind: 'auto_format' },
    ],
  },
  {
    id: 'field-clip',
    name: 'Field clip',
    description: 'Trimmed, resized and transcoded for playback on site connections.',
    resourceType: 'video',
    audience: 'operations',
    steps: [
      { kind: 'trim', params: { start: 0, duration: 8 } },
      { kind: 'resize', params: { width: 960 } },
      { kind: 'auto_quality' },
      { kind: 'auto_format' },
    ],
  },
  {
    id: 'vertical-brief',
    name: 'Vertical brief',
    description: 'AI subject-tracking reframe to 9:16 for mobile briefings.',
    resourceType: 'video',
    audience: 'operations',
    steps: [
      { kind: 'trim', params: { start: 0, duration: 6 } },
      { kind: 'smart_reframe', params: { aspect: '9:16' } },
      { kind: 'resize', params: { width: 540 } },
      { kind: 'auto_quality' },
    ],
  },
  {
    id: 'ai-highlights',
    name: 'AI highlights',
    description: 'Cloudinary AI condenses long footage into its most relevant seconds.',
    resourceType: 'video',
    audience: 'operations',
    steps: [
      { kind: 'ai_preview', params: { duration: 6 } },
      { kind: 'resize', params: { width: 960 } },
      { kind: 'auto_quality' },
    ],
  },
  {
    id: 'product-studio',
    name: 'Product studio',
    description: 'Background removal, generative marble backdrop and a square canvas — the classic e-commerce chain.',
    resourceType: 'image',
    audience: 'general',
    suggestedFor: ['ref-sneaker'],
    steps: [
      { kind: 'gen_background_replace', params: { prompt: 'polished white marble countertop with soft warm studio light' } },
      { kind: 'gen_fill', params: { aspect: '1:1', width: 1200, prompt: '' } },
      { kind: 'auto_quality' },
      { kind: 'auto_format' },
    ],
  },
  {
    id: 'creative-recolor',
    name: 'Colourway',
    description: 'Generative recolour of a described object while keeping its shading.',
    resourceType: 'image',
    audience: 'general',
    suggestedFor: ['ref-sneaker'],
    steps: [
      { kind: 'gen_recolor', params: { prompt: 'shoes', color: '2F6BFF' } },
      { kind: 'auto_quality' },
      { kind: 'auto_format' },
    ],
  },
];

export function presetSteps(preset: PipelinePreset): PipelineStep[] {
  return preset.steps.map((s) => createStep(s.kind, s.params));
}

export function defaultPresetFor(asset: MediaAsset): PipelinePreset {
  if (asset.resourceType === 'video') return PRESETS.find((p) => p.id === 'field-clip')!;
  return PRESETS.find((p) => p.id === 'evidence-enhance')!;
}
