'use client';

import { motion } from 'framer-motion';
import {
  INTEGRITY_HELP,
  INTEGRITY_LABEL,
  STEP_DEFINITIONS,
  STEP_ORDER,
  type Integrity,
  type StepKind,
} from '@/lib/cloudinary/pipeline';
import { transformationFromUrl } from '@/lib/cloudinary/url';
import { cn } from '@/components/ui/cn';
import { EASE_EDITORIAL } from './hooks';
import { REPORT_FRAME_URL } from './report-sample';

/** The Cloudinary parameter each pipeline step contributes to a delivery URL. */
const PARAM: Record<StepKind, string> = {
  smart_crop: 'c_fill,g_auto',
  resize: 'c_limit',
  improve: 'e_improve',
  sharpen: 'e_sharpen',
  privacy_faces: 'e_pixelate_faces',
  text_stamp: 'l_text',
  remove_background: 'e_background_removal',
  enhance: 'e_enhance',
  gen_background_replace: 'e_gen_background_replace',
  gen_fill: 'b_gen_fill',
  gen_replace: 'e_gen_replace',
  gen_recolor: 'e_gen_recolor',
  gen_remove: 'e_gen_remove',
  gen_restore: 'e_gen_restore',
  upscale: 'e_upscale',
  trim: 'so_,du_',
  smart_reframe: 'c_fill,g_auto',
  ai_preview: 'e_preview',
  auto_quality: 'q_auto',
  auto_format: 'f_auto',
};

interface ClassRow {
  integrity: Integrity;
  color: string;
  use: string;
  rule: string;
}

const ROWS: ClassRow[] = [
  {
    integrity: 'evidence',
    color: 'var(--color-signal)',
    use: 'Inspection records, incident reports and exports — the frames handed to contractors, insurers and auditors.',
    rule: 'The only class VisualOps places in a report.',
  },
  {
    integrity: 'ai-edit',
    color: 'var(--color-medium)',
    use: 'Asset registers and internal briefings, labelled “AI edit” wherever they appear.',
    rule: 'The untouched original stays the record.',
  },
  {
    integrity: 'generative',
    color: 'var(--color-high)',
    use: 'Previews and communication only, labelled “Generative” wherever they appear.',
    rule: 'Never placed in a report or presented as evidence.',
  },
];

/** Components of the report frame shown on this page (ReportPaper, Fig. 1), read back from its Cloudinary URL. */
const REPORT_COMPONENTS = transformationFromUrl(REPORT_FRAME_URL);

function inReportFrame(token: string): boolean {
  const wanted = token.split(',');
  return REPORT_COMPONENTS.some((comp) => {
    const parts = comp.split(',');
    return wanted.every((w) => parts.some((p) => p === w || p.startsWith(`${w}:`)));
  });
}

interface Token {
  token: string;
  labels: string[];
  used: boolean;
}

/** Tokens per integrity class, derived from the pipeline's own step definitions. */
function tokensFor(integrity: Integrity): Token[] {
  const byToken = new Map<string, Token>();
  for (const kind of STEP_ORDER) {
    const def = STEP_DEFINITIONS[kind];
    if (def.integrity !== integrity) continue;
    const token = PARAM[kind];
    const existing = byToken.get(token);
    if (existing) existing.labels.push(def.label);
    else byToken.set(token, { token, labels: [def.label], used: integrity === 'evidence' && inReportFrame(token) });
  }
  return Array.from(byToken.values());
}

const firstSentence = (text: string) => text.split(/(?<=\.)\s/)[0];

/**
 * Editorial specification table of the three evidence-integrity classes.
 * A real table on tablet and up; stacked, self-labelled rows on phones.
 * `stacked` keeps the self-labelled rows at every width (for a narrow column),
 * with the parameters and the usage side by side from `sm` up.
 */
export function IntegrityTable({ className, stacked = false }: { className?: string; stacked?: boolean }) {
  const cls = stacked
    ? {
        head: 'sr-only',
        row: 'grid gap-x-6 gap-y-4 border-b border-line py-6 sm:grid-cols-2',
        rowHeader: 'block align-top font-normal sm:col-span-2',
        cell: 'block align-top',
        lastCell: 'block align-top',
        cellLabel: 'label mb-2 block',
      }
    : {
        head: 'max-md:sr-only',
        row: 'grid gap-y-5 border-b border-line py-7 md:table-row md:py-0',
        rowHeader: 'block align-top font-normal md:table-cell md:py-8 md:pr-6',
        cell: 'block align-top md:table-cell md:py-8 md:pr-6',
        lastCell: 'block align-top md:table-cell md:py-8',
        cellLabel: 'label mb-2 block md:hidden',
      };
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-6 border-t border-ink pt-4">
        <p className="label text-ink">Table 1 — Integrity classes</p>
        <p className="label hidden text-right sm:block">Assigned per pipeline step</p>
      </div>

      <table className="mt-1 w-full border-collapse text-left" role="table">
        <caption className="sr-only">
          Evidence integrity classes: the Cloudinary parameters each includes and where its output may be used.
        </caption>
        <thead className={cls.head}>
          <tr className="border-b border-line">
            <th scope="col" className="label py-3.5 pr-6 font-normal md:w-[29%]">
              Class
            </th>
            <th scope="col" className="label py-3.5 pr-6 font-normal">
              Cloudinary parameters
            </th>
            <th scope="col" className="label py-3.5 font-normal md:w-[33%]">
              Where it may be used
            </th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row, i) => {
            const tokens = tokensFor(row.integrity);
            return (
              <motion.tr
                key={row.integrity}
                role="row"
                className={cls.row}
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true, margin: '0px 0px -8% 0px' }}
                transition={{ duration: 0.6, delay: i * 0.1, ease: EASE_EDITORIAL }}
              >
                <th scope="row" role="rowheader" className={cls.rowHeader}>
                  <span className="flex items-center gap-2.5">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: row.color }} />
                    <span className="type-heading text-[22px] text-ink sm:text-[24px]">{INTEGRITY_LABEL[row.integrity]}</span>
                  </span>
                  <span className="mt-2 block max-w-[24ch] text-[13.5px] leading-snug text-ink-2">
                    {firstSentence(INTEGRITY_HELP[row.integrity])}
                  </span>
                </th>
                <td role="cell" className={cls.cell}>
                  <span aria-hidden className={cls.cellLabel}>
                    Cloudinary parameters
                  </span>
                  <ul className="flex flex-wrap items-baseline gap-y-1 font-mono text-[12px] leading-[1.7]">
                    {tokens.map((t, ti) => (
                      <li key={t.token} className="inline-flex items-baseline whitespace-nowrap" title={t.labels.join(' · ')}>
                        <code className={cn(t.used ? 'text-signal' : 'text-ink-2')}>
                          {t.token}
                          {t.used && <span className="sr-only"> (in the report frame on this page)</span>}
                        </code>
                        {ti < tokens.length - 1 && (
                          <span aria-hidden className="px-1.5 text-ink-3/60">
                            /
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <span className="label mt-3 block normal-case tracking-[0.02em]">
                    {tokens.reduce((n, t) => n + t.labels.length, 0)} pipeline steps
                  </span>
                </td>
                <td role="cell" className={cls.lastCell}>
                  <span aria-hidden className={cls.cellLabel}>
                    Where it may be used
                  </span>
                  <p className="text-pretty text-[14px] leading-[1.6] text-ink-2">{row.use}</p>
                  <p className="mt-2.5 text-[14px] font-medium leading-snug text-ink">{row.rule}</p>
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>

      <p className="mt-5 flex items-start gap-2.5 text-[12.5px] leading-relaxed text-ink-3">
        <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-signal" />
        <span>
          Parameters in cyan are in the evidence frame of the report on this page (Fig. 1) — read back from its Cloudinary URL, not
          typed in.
        </span>
      </p>
    </div>
  );
}
