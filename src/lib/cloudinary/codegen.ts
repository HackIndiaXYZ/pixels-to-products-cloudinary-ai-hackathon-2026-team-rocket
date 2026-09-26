import type { MediaAsset } from '@/lib/types';
import {
  STEP_DEFINITIONS,
  aspect,
  expandStampText,
  num,
  pipelineComponents,
  pipelineIntegrity,
  pipelineUrl,
  smartCropWidth,
  stampComponent,
  stampPosition,
  str,
  type PipelineStep,
} from './pipeline';
import { encodePrompt, sanitizeColor, sanitizeFileName, sanitizePrompt } from './url';

/**
 * Code export for a pipeline: the exact Cloudinary URL, next-cloudinary (React),
 * the Node.js and Python SDKs, cURL and the pipeline state as JSON.
 *
 * The SDK transformation objects below mirror `STEP_DEFINITIONS[kind].build`
 * one-to-one; `scripts/verify-cloudinary.mjs` runs the Node SDK and
 * next-cloudinary's URL loader against these snippets to prove they render
 * the same transformations as the URL VisualOps displays.
 */

export type SdkValue = string | number | boolean | { [key: string]: SdkValue };
export type SdkTransformation = Record<string, SdkValue>;

export function sdkTransformation(step: PipelineStep, asset: MediaAsset): SdkTransformation | null {
  const p = step.params;
  const video = asset.resourceType === 'video';
  switch (step.kind) {
    case 'smart_crop':
      return {
        aspect_ratio: aspect(p.aspect),
        crop: 'fill',
        gravity: str(p.gravity, 'auto').replace(/[^a-z:]/g, '') || 'auto',
        // Same no-upscale cap as the rendered URL (see smartCropWidth).
        width: smartCropWidth(p, asset),
      };
    case 'resize':
      return { crop: video ? 'scale' : 'limit', width: num(p.width, 960, 160, 3840) };
    case 'improve': {
      const mode = str(p.mode, 'auto');
      return { effect: mode === 'outdoor' || mode === 'indoor' ? `improve:${mode}` : 'improve' };
    }
    case 'sharpen':
      return { effect: `sharpen:${num(p.strength, 60, 1, 400)}` };
    case 'privacy_faces':
      return str(p.mode) === 'blur'
        ? { effect: `blur_faces:${num(p.strength, 20, 1, 200) * 10}` }
        : { effect: `pixelate_faces:${num(p.strength, 20, 1, 200)}` };
    case 'text_stamp': {
      const text = expandStampText(str(p.text, '{id} · {severity} · {date}'), asset);
      if (!text) return null;
      return {
        overlay: { font_family: 'Arial', font_size: num(p.size, 28, 12, 96), font_weight: 'bold', text },
        background: '#0B0C0E',
        color: '#FFFFFF',
        gravity: stampPosition(p.position),
        x: 24,
        y: 24,
      };
    }
    case 'remove_background':
      return { effect: 'background_removal' };
    case 'enhance':
      return { effect: 'enhance' };
    case 'gen_background_replace': {
      const prompt = encodePrompt(str(p.prompt));
      return { effect: prompt ? `gen_background_replace:prompt_${prompt}` : 'gen_background_replace' };
    }
    case 'gen_fill': {
      const prompt = encodePrompt(str(p.prompt));
      return {
        aspect_ratio: aspect(p.aspect),
        background: prompt ? `gen_fill:prompt_${prompt}` : 'gen_fill',
        crop: 'pad',
        width: num(p.width, 1600, 200, 3200),
      };
    }
    case 'gen_replace': {
      const from = encodePrompt(str(p.from));
      const to = encodePrompt(str(p.to));
      if (!from || !to) return null;
      return { effect: `gen_replace:from_${from};to_${to}${p.preserveGeometry === true ? ';preserve-geometry_true' : ''}` };
    }
    case 'gen_recolor': {
      const prompt = encodePrompt(str(p.prompt));
      if (!prompt) return null;
      return { effect: `gen_recolor:prompt_${prompt};to-color_${sanitizeColor(str(p.color), 'FF6A00')}` };
    }
    case 'gen_remove': {
      const prompt = encodePrompt(str(p.prompt));
      return prompt ? { effect: `gen_remove:prompt_${prompt}` } : null;
    }
    case 'gen_restore':
      return { effect: 'gen_restore' };
    case 'upscale':
      return { effect: 'upscale' };
    case 'trim':
      return { duration: num(p.duration, 8, 1, 120), start_offset: num(p.start, 0, 0, 600) };
    case 'smart_reframe':
      return { aspect_ratio: aspect(p.aspect, '9:16'), crop: 'fill', gravity: 'auto' };
    case 'ai_preview':
      return { effect: `preview:duration_${num(p.duration, 6, 2, 30)}` };
    case 'auto_quality': {
      const level = str(p.level, 'auto');
      return { quality: ['auto', 'auto:best', 'auto:good', 'auto:eco'].includes(level) ? level : 'auto' };
    }
    case 'auto_format':
      return video ? { video_codec: 'auto' } : { fetch_format: 'auto' };
    default:
      return null;
  }
}

function activeSteps(steps: PipelineStep[], asset: MediaAsset): PipelineStep[] {
  return steps.filter((s) => s.enabled && STEP_DEFINITIONS[s.kind].appliesTo.includes(asset.resourceType));
}

export function sdkTransformations(steps: PipelineStep[], asset: MediaAsset): SdkTransformation[] {
  return activeSteps(steps, asset)
    .map((s) => sdkTransformation(s, asset))
    .filter((t): t is SdkTransformation => t !== null);
}

const ratio = (value: string): [number, number] => {
  const [w, h] = value.split(':').map(Number);
  return w > 0 && h > 0 ? [w, h] : [16, 9];
};

/**
 * Pixel size of a still pipeline's output, following its geometry steps in
 * order (smart crop, resize, generative fill). The exported CldImage uses it
 * for `width`/`height` so next/image reserves the rendered aspect ratio, not
 * the original's. AI steps that resample (e_upscale) are not modelled.
 */
export function renderedSize(steps: PipelineStep[], asset: MediaAsset): { width: number; height: number } {
  let width = asset.width > 0 ? asset.width : 1600;
  let height = asset.height > 0 ? asset.height : 900;
  for (const step of activeSteps(steps, asset)) {
    const p = step.params;
    if (step.kind === 'smart_crop') {
      const [aw, ah] = ratio(aspect(p.aspect));
      width = smartCropWidth(p, asset);
      height = (width * ah) / aw;
    } else if (step.kind === 'resize') {
      const max = num(p.width, 960, 160, 3840);
      if (width > max) {
        height = (height * max) / width;
        width = max;
      }
    } else if (step.kind === 'gen_fill') {
      const [aw, ah] = ratio(aspect(p.aspect));
      width = num(p.width, 1600, 200, 3200);
      height = (width * ah) / aw;
    }
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** The `width` prop of the exported CldImage: the rendered width, at most 1600 px. */
export function cldImageWidth(steps: PipelineStep[], asset: MediaAsset): number {
  return Math.min(renderedSize(steps, asset).width, 1600);
}

/* ------------------------------------------------------------------------ */
/* Serialisers                                                               */
/* ------------------------------------------------------------------------ */

function jsValue(value: SdkValue, quote: "'" | '"'): string {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return `${quote}${value.replace(/\\/g, '\\\\').replace(new RegExp(quote, 'g'), `\\${quote}`)}${quote}`;
  const inner = Object.entries(value)
    .map(([k, v]) => `${k}: ${jsValue(v, quote)}`)
    .join(', ');
  return `{ ${inner} }`;
}

function pyValue(value: SdkValue): string {
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  const inner = Object.entries(value)
    .map(([k, v]) => `"${k}": ${pyValue(v)}`)
    .join(', ');
  return `{${inner}}`;
}

/* ------------------------------------------------------------------------ */
/* next-cloudinary                                                           */
/* ------------------------------------------------------------------------ */

export interface CldImageSpec {
  /** Idiomatic next-cloudinary props for the generative steps it supports natively. */
  props: Record<string, string | boolean | string[]>;
  /** Every other step, as exact transformation components. */
  rawTransformations: string[];
}

export function cldImageSpec(steps: PipelineStep[], asset: MediaAsset): CldImageSpec {
  const props: CldImageSpec['props'] = {};
  const raw: string[] = [];
  for (const step of activeSteps(steps, asset)) {
    const p = step.params;
    switch (step.kind) {
      case 'remove_background':
        props.removeBackground = true;
        break;
      case 'enhance':
        props.enhance = true;
        break;
      case 'gen_restore':
        props.restore = true;
        break;
      case 'gen_background_replace': {
        const prompt = sanitizePrompt(str(p.prompt));
        props.replaceBackground = prompt || true;
        break;
      }
      case 'gen_replace': {
        const from = sanitizePrompt(str(p.from));
        const to = sanitizePrompt(str(p.to));
        if (from && to) props.replace = p.preserveGeometry === true ? [from, to, 'true'] : [from, to];
        break;
      }
      case 'gen_recolor': {
        const prompt = sanitizePrompt(str(p.prompt));
        if (prompt) props.recolor = [prompt, sanitizeColor(str(p.color), 'FF6A00')];
        break;
      }
      case 'gen_remove': {
        const prompt = sanitizePrompt(str(p.prompt));
        if (prompt) props.remove = prompt;
        break;
      }
      case 'auto_quality':
      case 'auto_format':
        // CldImage applies f_auto and q_auto by default.
        break;
      case 'text_stamp': {
        // next-cloudinary URL-encodes raw transformations itself, so pass readable text.
        const stamp = stampComponent(p, asset, false);
        if (stamp) raw.push(stamp);
        break;
      }
      default: {
        const built = STEP_DEFINITIONS[step.kind].build(p, { asset });
        if (built) raw.push(built);
      }
    }
  }
  return { props, rawTransformations: raw };
}

function jsxProp(name: string, value: string | boolean | string[]): string {
  if (value === true) return name;
  if (typeof value === 'string') return `${name}="${value.replace(/"/g, '&quot;')}"`;
  if (Array.isArray(value)) return `${name}={[${value.map((v) => `'${v.replace(/'/g, "\\'")}'`).join(', ')}]}`;
  return `${name}={false}`;
}

/* ------------------------------------------------------------------------ */
/* Snippets                                                                  */
/* ------------------------------------------------------------------------ */

export interface CodeSnippets {
  url: string;
  react: string;
  node: string;
  python: string;
  curl: string;
  json: string;
}

export function generateSnippets(steps: PipelineStep[], asset: MediaAsset): CodeSnippets {
  const url = pipelineUrl(steps, asset);
  const transformations = sdkTransformations(steps, asset);
  const components = pipelineComponents(steps, asset);
  const video = asset.resourceType === 'video';
  const quoteId = asset.publicId.replace(/'/g, "\\'");

  const nodeTransform = transformations.length
    ? `\n  transformation: [\n${transformations.map((t) => `    ${jsValue(t, "'")},`).join('\n')}\n  ],`
    : '';
  const node = `import { v2 as cloudinary } from 'cloudinary';

// Delivery URLs only need the cloud name — no API secret required.
cloudinary.config({ cloud_name: '${asset.cloudName}', secure: true });

const url = cloudinary.url('${quoteId}', {
  resource_type: '${asset.resourceType}',${video ? "\n  format: 'mp4'," : ''}${nodeTransform}
});

console.log(url);`;

  const pyTransform = transformations.length
    ? `\n    transformation=[\n${transformations.map((t) => `        ${pyValue(t)},`).join('\n')}\n    ],`
    : '';
  const python = `import cloudinary
from cloudinary.utils import cloudinary_url

# Delivery URLs only need the cloud name — no API secret required.
cloudinary.config(cloud_name="${asset.cloudName}", secure=True)

url, _ = cloudinary_url(
    "${asset.publicId.replace(/"/g, '\\"')}",
    resource_type="${asset.resourceType}",${video ? '\n    format="mp4",' : ''}${pyTransform}
)

print(url)`;

  let react: string;
  if (video) {
    const raw = components.map((c) => `      '${c}',`).join('\n');
    react = `import { getCldVideoUrl } from 'next-cloudinary';

const src = getCldVideoUrl(
  {
    src: '${quoteId}',
    rawTransformations: [
${raw}
    ],
  },
  { cloud: { cloudName: '${asset.cloudName}' } },
);

export function FieldClip() {
  return <video src={src} controls playsInline preload="metadata" />;
}`;
  } else {
    const spec = cldImageSpec(steps, asset);
    const size = renderedSize(steps, asset);
    const width = cldImageWidth(steps, asset);
    const lines = [
      `src="${asset.publicId}"`,
      `width={${width}}`,
      `height={${Math.max(1, Math.round((width / size.width) * size.height))}}`,
      `alt="${(asset.finding?.title ?? asset.title).replace(/"/g, '&quot;')}"`,
      `config={{ cloud: { cloudName: '${asset.cloudName}' } }}`,
      ...Object.entries(spec.props).map(([k, v]) => jsxProp(k, v)),
    ];
    if (spec.rawTransformations.length) {
      lines.push(`rawTransformations={[${spec.rawTransformations.map((c) => `'${c}'`).join(', ')}]}`);
    }
    const note =
      Object.keys(spec.props).length && spec.rawTransformations.length
        ? `\n// next-cloudinary applies its AI props in a fixed plugin order and adds\n// c_limit, f_auto and q_auto itself. The URL tab is the exact render.`
        : `\n// CldImage adds responsive sizing (c_limit), f_auto and q_auto automatically.`;
    react = `import { CldImage } from 'next-cloudinary';
${note}
export function Evidence() {
  return (
    <CldImage
${lines.map((l) => `      ${l}`).join('\n')}
    />
  );
}`;
  }

  const ext = video ? 'mp4' : steps.some((s) => s.enabled && s.kind === 'remove_background') ? 'png' : 'jpg';
  const curl = `# f_auto negotiates the format from the Accept header; curl sends */*.
curl -L "${url}" \\
  -o "${sanitizeFileName(asset.fileName)}-processed.${ext}"`;

  const json = JSON.stringify(
    {
      schema: 'visualops.pipeline/v1',
      asset: {
        cloudName: asset.cloudName,
        publicId: asset.publicId,
        resourceType: asset.resourceType,
        fileName: asset.fileName,
      },
      integrity: pipelineIntegrity(steps, asset),
      steps: steps.map((s) => ({
        kind: s.kind,
        enabled: s.enabled,
        params: s.params,
        component: STEP_DEFINITIONS[s.kind].appliesTo.includes(asset.resourceType)
          ? STEP_DEFINITIONS[s.kind].build(s.params, { asset })
          : null,
        integrity: STEP_DEFINITIONS[s.kind].integrity,
      })),
      url,
    },
    null,
    2,
  );

  return { url, react, node, python, curl, json };
}
