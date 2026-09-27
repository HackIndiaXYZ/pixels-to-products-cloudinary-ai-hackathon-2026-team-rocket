'use client';

import { AnimatePresence, Reorder, motion, useDragControls } from 'framer-motion';
import { ChevronDown, Eye, EyeOff, GripVertical, Plus, ScanEye, Trash2 } from 'lucide-react';
import { useState } from 'react';
import type { MediaAsset } from '@/lib/types';
import {
  INTEGRITY_HELP,
  STEP_DEFINITIONS,
  createStep,
  objectHints,
  stepsFor,
  type FieldDef,
  type Integrity,
  type ObjectHint,
  type PipelineStep,
  type StepGroup,
  type StepKind,
  type StepParams,
} from '@/lib/cloudinary/pipeline';
import { sanitizeColor } from '@/lib/cloudinary/url';
import { cn } from '@/components/ui/cn';

const INTEGRITY_DOT: Record<Integrity, string> = {
  evidence: 'bg-signal',
  'ai-edit': 'bg-medium',
  generative: 'bg-high',
};

/** Which of the asset's object hints each object prompt suggests, so the three steps do not all say the same thing. */
const HINT_INDEX: Partial<Record<StepKind, number>> = { gen_replace: 0, gen_recolor: 1, gen_remove: 2 };

/**
 * The placeholder and help for an object prompt: an object from this frame — one Cloudinary
 * detected, else one the record's tags name — never another frame's object.
 */
function objectPrompt(field: FieldDef, kind: StepKind, hints: ObjectHint[]): Pick<FieldDef, 'placeholder' | 'help'> {
  if (field.hint !== 'object' || !hints.length) return { placeholder: field.placeholder, help: field.help };
  const hint = hints[HINT_INDEX[kind] ?? 0] ?? hints[0];
  return {
    placeholder: `e.g. ${hint.text}`,
    help: hint.source === 'ai' ? 'Example: an object Cloudinary’s AI detected in this frame.' : 'Example: an object named in this record’s tags.',
  };
}

export function PipelineEditor({
  asset,
  steps,
  onChange,
  previewIndex,
  onPreview,
}: {
  asset: MediaAsset;
  steps: PipelineStep[];
  onChange: (steps: PipelineStep[]) => void;
  previewIndex: number | null;
  onPreview: (index: number | null) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const update = (id: string, patch: Partial<PipelineStep>) =>
    onChange(steps.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const updateParams = (id: string, params: StepParams) =>
    onChange(steps.map((s) => (s.id === id ? { ...s, params: { ...s.params, ...params } } : s)));

  const available = stepsFor(asset.resourceType);
  const groups = Array.from(new Set(available.map((d) => d.group))) as StepGroup[];

  return (
    <div className="space-y-2">
      {steps.length === 0 && (
        <div className="rounded-[10px] border border-dashed border-line-strong px-4 py-6 text-center text-[12.5px] text-ink-3">
          Empty pipeline — the output is the untouched original. Add a step or load a preset.
        </div>
      )}
      <Reorder.Group axis="y" values={steps} onReorder={onChange} className="space-y-1.5">
        {steps.map((step, index) => (
          <StepCard
            key={step.id}
            step={step}
            index={index}
            asset={asset}
            expanded={expanded === step.id}
            onExpand={() => setExpanded(expanded === step.id ? null : step.id)}
            onToggle={() => update(step.id, { enabled: !step.enabled })}
            onRemove={() => {
              onChange(steps.filter((s) => s.id !== step.id));
              if (previewIndex !== null) onPreview(null);
            }}
            onParams={(p) => updateParams(step.id, p)}
            previewing={previewIndex === index}
            onPreview={() => onPreview(previewIndex === index ? null : index)}
          />
        ))}
      </Reorder.Group>

      <div className="relative">
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          aria-expanded={adding}
          className="flex w-full items-center justify-center gap-1.5 rounded-[9px] border border-dashed border-line-strong py-2 text-[12.5px] text-ink-2 transition-colors hover:border-signal hover:text-ink"
        >
          <Plus className="h-3.5 w-3.5" /> Add step
        </button>
        <AnimatePresence>
          {adding && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="mt-2 max-h-[360px] overflow-y-auto rounded-[10px] border border-line-strong bg-raised p-2"
            >
              {groups.map((group) => (
                <div key={group} className="mb-2 last:mb-0">
                  <div className="label px-2 py-1">{group}</div>
                  {available
                    .filter((d) => d.group === group)
                    .map((d) => (
                      <button
                        key={d.kind}
                        type="button"
                        onClick={() => {
                          const step = createStep(d.kind);
                          onChange([...steps, step]);
                          setExpanded(d.fields.length ? step.id : null);
                          setAdding(false);
                        }}
                        className="flex w-full items-start gap-2.5 rounded-[7px] px-2 py-1.5 text-left hover:bg-overlay"
                      >
                        <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', INTEGRITY_DOT[d.integrity])} />
                        <span className="min-w-0">
                          <span className="block text-[12.5px] font-medium text-ink">
                            {d.label}
                            {d.async && <span className="ml-1.5 font-mono text-[10px] text-ink-3">async</span>}
                          </span>
                          <span className="block text-[11.5px] leading-snug text-ink-3">{d.description}</span>
                        </span>
                      </button>
                    ))}
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-[11px] text-ink-3">
        {(['evidence', 'ai-edit', 'generative'] as Integrity[]).map((i) => (
          <span key={i} className="flex items-center gap-1.5" title={INTEGRITY_HELP[i]}>
            <span className={cn('h-1.5 w-1.5 rounded-full', INTEGRITY_DOT[i])} />
            {i === 'evidence' ? 'Evidence-safe' : i === 'ai-edit' ? 'AI edit' : 'Generative'}
          </span>
        ))}
      </div>
    </div>
  );
}

function StepCard({
  step,
  index,
  asset,
  expanded,
  onExpand,
  onToggle,
  onRemove,
  onParams,
  previewing,
  onPreview,
}: {
  step: PipelineStep;
  index: number;
  asset: MediaAsset;
  expanded: boolean;
  onExpand: () => void;
  onToggle: () => void;
  onRemove: () => void;
  onParams: (p: StepParams) => void;
  previewing: boolean;
  onPreview: () => void;
}) {
  const controls = useDragControls();
  const def = STEP_DEFINITIONS[step.kind];
  const applies = def.appliesTo.includes(asset.resourceType);
  const component = applies ? def.build(step.params, { asset }) : null;
  const hints = def.fields.some((f) => f.hint === 'object') ? objectHints(asset) : [];

  return (
    <Reorder.Item
      value={step}
      dragListener={false}
      dragControls={controls}
      className={cn(
        'rounded-[10px] border bg-surface',
        previewing ? 'border-signal' : 'border-line',
        (!step.enabled || !applies) && 'opacity-55',
      )}
      whileDrag={{ scale: 1.015, boxShadow: '0 12px 30px -10px rgba(0,0,0,0.7)' }}
    >
      <div className="flex items-center gap-1.5 py-1.5 pl-1 pr-1.5">
        <button
          type="button"
          onPointerDown={(e) => controls.start(e)}
          className="flex h-7 w-5 cursor-grab touch-none items-center justify-center text-ink-3 active:cursor-grabbing"
          aria-label={`Reorder ${def.label}`}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <span className="num w-4 font-mono text-[10.5px] text-ink-3">{index + 1}</span>
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', INTEGRITY_DOT[def.integrity])} title={INTEGRITY_HELP[def.integrity]} />
        <button type="button" onClick={onExpand} className="min-w-0 flex-1 px-1 text-left" aria-expanded={expanded}>
          <span className="block truncate text-[12.5px] font-medium">{def.label}</span>
          <span className="block truncate font-mono text-[10.5px] text-ink-3">
            {applies ? component ?? 'incomplete — set parameters' : `not available for ${asset.resourceType}`}
          </span>
        </button>
        <button
          type="button"
          onClick={onPreview}
          className={cn('btn btn-ghost btn-sm btn-icon', previewing && 'text-signal')}
          title="Preview the output up to this step"
          aria-pressed={previewing}
        >
          <ScanEye className="h-3.5 w-3.5" />
        </button>
        <button type="button" onClick={onToggle} className="btn btn-ghost btn-sm btn-icon" title={step.enabled ? 'Disable step' : 'Enable step'}>
          {step.enabled ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
        </button>
        {def.fields.length > 0 && (
          <button type="button" onClick={onExpand} className="btn btn-ghost btn-sm btn-icon" aria-label="Configure">
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
        <button type="button" onClick={onRemove} className="btn btn-ghost btn-sm btn-icon hover:text-critical" aria-label={`Remove ${def.label}`}>
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {expanded && def.fields.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="grid gap-2.5 border-t border-line px-3 py-3 sm:grid-cols-2">
              <p className="text-[11.5px] leading-relaxed text-ink-3 sm:col-span-2">{def.description}</p>
              {def.fields.map((field) => (
                <Field
                  key={field.key}
                  field={{ ...field, ...objectPrompt(field, step.kind, hints) }}
                  value={step.params[field.key]}
                  onChange={(v) => onParams({ [field.key]: v })}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FieldDef;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  const id = `f-${field.key}`;
  const wide = field.type === 'text';
  return (
    <label htmlFor={id} className={cn('block space-y-1', wide && 'sm:col-span-2')}>
      <span className="text-[11.5px] text-ink-2">{field.label}</span>
      {field.type === 'select' && (
        <select id={id} className="input h-8 text-[12.5px]" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {field.type === 'text' && (
        <input
          id={id}
          className="input h-8 text-[12.5px]"
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          maxLength={140}
        />
      )}
      {field.type === 'number' && (
        <input
          id={id}
          type="number"
          className="input num h-8 text-[12.5px]"
          value={Number(value ?? 0)}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(e) => onChange(e.target.value === '' ? 0 : Number(e.target.value))}
        />
      )}
      {field.type === 'color' && (
        <span className="flex items-center gap-2">
          <input
            id={id}
            type="color"
            className="h-8 w-10 cursor-pointer rounded-[6px] border border-line-strong bg-canvas p-0.5"
            value={`#${sanitizeColor(String(value ?? 'FF6A00'), 'FF6A00').slice(0, 6)}`}
            onChange={(e) => onChange(e.target.value.replace('#', '').toUpperCase())}
          />
          <span className="font-mono text-[11.5px] text-ink-2">#{sanitizeColor(String(value ?? ''), 'FF6A00')}</span>
        </span>
      )}
      {field.type === 'toggle' && (
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={value === true}
          onClick={() => onChange(value !== true)}
          className={cn('relative h-5 w-9 rounded-full border transition-colors', value === true ? 'border-signal bg-signal' : 'border-line-strong bg-canvas')}
        >
          <span className={cn('absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all', value === true ? 'left-[18px] bg-signal-ink' : 'left-0.5 bg-ink-3')} />
        </button>
      )}
      {field.help && <span className="block text-[11px] text-ink-3">{field.help}</span>}
    </label>
  );
}
