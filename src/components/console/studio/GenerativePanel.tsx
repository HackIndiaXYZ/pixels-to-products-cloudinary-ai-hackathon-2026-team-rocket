'use client';

import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { MediaAsset } from '@/lib/types';
import { createStep, type PipelineStep, type StepKind, type StepParams } from '@/lib/cloudinary/pipeline';
import { sanitizePrompt } from '@/lib/cloudinary/url';
import { cn } from '@/components/ui/cn';

const BACKGROUND_PROMPTS: Array<{ label: string; prompt: string; audience: 'operations' | 'general' }> = [
  { label: 'Clean depot floor', prompt: 'clean concrete depot floor in soft overcast daylight', audience: 'operations' },
  { label: 'Neutral grey studio', prompt: 'seamless neutral grey studio backdrop with soft even light', audience: 'operations' },
  { label: 'Site at golden hour', prompt: 'construction site at golden hour with a clear sky', audience: 'operations' },
  { label: 'Workshop bench', prompt: 'tidy engineering workshop bench with tool wall behind', audience: 'operations' },
  { label: 'White marble', prompt: 'polished white marble countertop with soft warm studio light', audience: 'general' },
  { label: 'Rainy neon street', prompt: 'rainy city street at night with neon reflections', audience: 'general' },
];

const DELIVERY: StepKind[] = ['auto_quality', 'auto_format'];

/** Insert or update a step, keeping delivery steps (q_auto / f_auto) last. */
export function upsertStep(steps: PipelineStep[], kind: StepKind, params: StepParams): PipelineStep[] {
  const existing = steps.find((s) => s.kind === kind);
  if (existing) {
    return steps.map((s) => (s.id === existing.id ? { ...s, enabled: true, params: { ...s.params, ...params } } : s));
  }
  const step = createStep(kind, params);
  const firstDelivery = steps.findIndex((s) => DELIVERY.includes(s.kind));
  if (firstDelivery === -1) return [...steps, step];
  return [...steps.slice(0, firstDelivery), step, ...steps.slice(firstDelivery)];
}

export function GenerativePanel({
  asset,
  steps,
  onChange,
}: {
  asset: MediaAsset;
  steps: PipelineStep[];
  onChange: (steps: PipelineStep[]) => void;
}) {
  const current = (kind: StepKind, key: string, fallback = '') => String(steps.find((s) => s.kind === kind)?.params[key] ?? fallback);
  const [bgPrompt, setBgPrompt] = useState(current('gen_background_replace', 'prompt'));
  const [from, setFrom] = useState(current('gen_replace', 'from', 'mop'));
  const [to, setTo] = useState(current('gen_replace', 'to', 'yellow wet floor warning sign'));
  const [recolorObject, setRecolorObject] = useState(current('gen_recolor', 'prompt', 'hard hat'));
  const [recolorColor, setRecolorColor] = useState(current('gen_recolor', 'color', 'FF6A00'));
  const [removeObject, setRemoveObject] = useState(current('gen_remove', 'prompt', ''));
  const [fillAspect, setFillAspect] = useState(current('gen_fill', 'aspect', '16:9'));

  if (asset.resourceType === 'video') {
    return (
      <p className="rounded-[10px] border border-line px-3 py-4 text-[12.5px] leading-relaxed text-ink-3">
        Generative image edits apply to photos. For video, use the Video steps in the pipeline: AI highlights (e_preview) and AI reframe (g_auto).
      </p>
    );
  }

  const apply = (kind: StepKind, params: StepParams) => onChange(upsertStep(steps, kind, params));

  return (
    <div className="space-y-4">
      <p className="rounded-[9px] border border-[color-mix(in_oklab,var(--color-high)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-high)_6%,transparent)] px-3 py-2 text-[12px] leading-relaxed text-ink-2">
        Generative edits synthesise new pixels. VisualOps marks the output <span className="text-high">Generative</span> and never uses it as inspection evidence — use it for briefings, catalogs and remediation previews.
      </p>

      <Section title="Background" hint="e_gen_background_replace">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            apply('gen_background_replace', { prompt: sanitizePrompt(bgPrompt) });
          }}
        >
          <input
            className="input h-8 text-[12.5px]"
            value={bgPrompt}
            onChange={(e) => setBgPrompt(e.target.value)}
            placeholder="Describe the new background…"
            maxLength={140}
            aria-label="Background prompt"
          />
          <button type="submit" className="btn btn-primary btn-sm shrink-0">
            <Sparkles className="h-3.5 w-3.5" /> Generate
          </button>
        </form>
        <div className="flex flex-wrap gap-1.5">
          {BACKGROUND_PROMPTS.filter((p) => asset.collection === 'reference' || p.audience === 'operations').map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setBgPrompt(p.prompt);
                apply('gen_background_replace', { prompt: p.prompt });
              }}
              className={cn(
                'rounded-[6px] border px-2 py-1 text-[11.5px] transition-colors',
                current('gen_background_replace', 'prompt') === p.prompt ? 'border-signal text-ink' : 'border-line text-ink-2 hover:border-line-strong hover:text-ink',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Replace an object" hint="e_gen_replace">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <input className="input h-8 text-[12.5px]" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Object to replace" maxLength={80} />
          <span className="text-[12px] text-ink-3">→</span>
          <input className="input h-8 text-[12.5px]" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Replacement" maxLength={80} />
        </div>
        <button type="button" className="btn btn-secondary btn-sm" disabled={!from.trim() || !to.trim()} onClick={() => apply('gen_replace', { from, to })}>
          Apply replace
        </button>
      </Section>

      <Section title="Recolour" hint="e_gen_recolor">
        <div className="flex items-center gap-2">
          <input className="input h-8 text-[12.5px]" value={recolorObject} onChange={(e) => setRecolorObject(e.target.value)} aria-label="Object to recolour" maxLength={80} />
          <input
            type="color"
            aria-label="Target colour"
            className="h-8 w-10 shrink-0 cursor-pointer rounded-[6px] border border-line-strong bg-canvas p-0.5"
            value={`#${recolorColor.slice(0, 6)}`}
            onChange={(e) => setRecolorColor(e.target.value.replace('#', '').toUpperCase())}
          />
          <button type="button" className="btn btn-secondary btn-sm shrink-0" disabled={!recolorObject.trim()} onClick={() => apply('gen_recolor', { prompt: recolorObject, color: recolorColor })}>
            Apply
          </button>
        </div>
      </Section>

      <Section title="Remove an object" hint="e_gen_remove">
        <div className="flex items-center gap-2">
          <input
            className="input h-8 text-[12.5px]"
            value={removeObject}
            onChange={(e) => setRemoveObject(e.target.value)}
            placeholder="e.g. mop bucket"
            aria-label="Object to remove"
            maxLength={80}
          />
          <button type="button" className="btn btn-secondary btn-sm shrink-0" disabled={!removeObject.trim()} onClick={() => apply('gen_remove', { prompt: removeObject })}>
            Apply
          </button>
        </div>
      </Section>

      <Section title="Extend the canvas" hint="b_gen_fill">
        <div className="flex items-center gap-2">
          <select className="input h-8 text-[12.5px]" value={fillAspect} onChange={(e) => setFillAspect(e.target.value)} aria-label="Aspect ratio">
            {['16:9', '4:3', '1:1', '4:5', '9:16'].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => apply('gen_fill', { aspect: fillAspect, width: 1600 })}>
            Apply fill
          </button>
        </div>
        <p className="text-[11.5px] text-ink-3">Cloudinary rejects generative fill on images with transparency — its error is shown in the viewer.</p>
      </Section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[12.5px] font-semibold">{title}</h3>
        <span className="font-mono text-[10.5px] text-ink-3">{hint}</span>
      </div>
      {children}
    </section>
  );
}
