import type { MediaAsset, Severity } from '@/lib/types';
import { CATEGORY_LABEL, SEVERITIES } from '@/lib/analytics';
import { pluralize } from '@/lib/format';
import {
  matchedVariants,
  parseQuery,
  relatedTerms,
  runQuery,
  variantsOf,
  type ParsedQuery,
  type SearchResult,
} from '@/lib/search/query';

/**
 * Ask VisualOps — the staged search run.
 *
 * Every stage the palette presents maps to a real computation over the field
 * records held by the console:
 *
 *   01 Searching visual index  → the record pool (count of indexed field records)
 *   02 Matching metadata       → parseQuery(): explicit filters + keywords, and how
 *                                many records each side matches on its own
 *   03 Filtering evidence      → runQuery(): filters and keywords combined
 *   04 Results                 → the ranked hits
 *
 * The work itself takes well under a millisecond; the palette only paces the
 * presentation of each stage (≤ STAGE_MS) so the interpretation can be read.
 */

export const ASK_EXAMPLES: readonly string[] = [
  'Show high severity issues from Building B',
  'Find construction photos containing cracks',
  'Show all damaged equipment',
  'Find all inspection media from this week',
  'Critical open issues',
];

/** Presentational pacing per stage (the computation itself is synchronous). */
export const STAGE_MS = 170;
/** Quiet period after the last keystroke before a query is run. */
export const DEBOUNCE_MS = 250;
/** Thumbnails shown in the visual index strip. */
export const STRIP_CAP = 20;
/** Results that fly out of the strip with a shared-layout transition. */
export const FLIGHT_CAP = 20;
/** Result tiles rendered at once (keeps image loads per view bounded). */
export const RESULT_PAGE = 30;

export type AskStage = 0 | 1 | 2 | 3 | 4;

export interface AskRun {
  id: number;
  /** Normalised query text. */
  query: string;
  parsed: ParsedQuery;
  result: SearchResult;
  /** Record ids in the final result. */
  hitIds: Set<string>;
  /** Records that pass the structured filters alone (null when the question has no filters). */
  filterIds: Set<string> | null;
  /** Records that mention at least one keyword (null when the question has no keywords). */
  keywordIds: Set<string> | null;
  /** Per keyword: how many records mention it (itself or a related term), ignoring the structured filters. */
  keywordReach: Record<string, number>;
  /**
   * Per keyword that is expanded with related terms: which of its terms those records
   * actually matched, so a match via "collapse" is never presented as a match on "damaged".
   */
  keywordVia: Record<string, KeywordVia>;
  /** Number of structured constraints understood (severity, category, site, media, status, time). */
  filterCount: number;
  /** Measured wall time of parse + filter, in milliseconds. */
  ms: number;
}

export interface KeywordVia {
  /** Some record matches the keyword as typed. */
  literal: boolean;
  /** The related terms records matched, in the order the search expands them. */
  related: string[];
}

export function normalizeQuery(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

const NO_FILTERS: Pick<ParsedQuery, 'severities' | 'categories' | 'sites' | 'mediaTypes' | 'statuses' | 'window'> = {
  severities: [],
  categories: [],
  sites: [],
  mediaTypes: [],
  statuses: [],
  window: undefined,
};

function idsOf(result: SearchResult): Set<string> {
  return new Set(result.hits.map((h) => h.asset.id));
}

function countFilters(parsed: ParsedQuery): number {
  return (
    parsed.severities.length +
    parsed.categories.length +
    parsed.sites.length +
    parsed.mediaTypes.length +
    parsed.statuses.length +
    (parsed.window ? 1 : 0)
  );
}

/** Runs a question end to end and records what each stage produced. Call from events, not render. */
export function computeRun(id: number, query: string, pool: MediaAsset[], sites: string[], now: number): AskRun {
  const t0 = performance.now();
  const parsed = parseQuery(query, sites, now);
  const result = runQuery(parsed, pool);
  const filterCount = countFilters(parsed);
  const filterIds = filterCount ? idsOf(runQuery({ ...parsed, keywords: [] }, pool)) : null;
  const keywordIds = result.keywords.length ? idsOf(runQuery({ ...parsed, ...NO_FILTERS }, pool)) : null;
  const keywordReach: Record<string, number> = {};
  const keywordVia: Record<string, KeywordVia> = {};
  for (const keyword of result.keywords) {
    const { hits } = runQuery({ ...parsed, ...NO_FILTERS, keywords: [keyword], understood: [] }, pool);
    keywordReach[keyword] = hits.length;
    if (relatedTerms(keyword).length) {
      const seen = new Set(hits.flatMap((h) => matchedVariants(h.asset, keyword)));
      keywordVia[keyword] = { literal: seen.has(keyword), related: relatedTerms(keyword).filter((v) => seen.has(v)) };
    }
  }
  const ms = performance.now() - t0;
  return { id, query, parsed, result, hitIds: idsOf(result), filterIds, keywordIds, keywordReach, keywordVia, filterCount, ms };
}

/** Related terms searched for the run's keywords, e.g. `{ keyword: 'damaged', related: ['damage', 'broken', …] }`. */
export function expansionsOf(run: AskRun): Array<{ keyword: string; related: string[] }> {
  return run.result.keywords.map((keyword) => ({ keyword, related: relatedTerms(keyword) })).filter((e) => e.related.length > 0);
}

/** Total related terms searched on top of the typed keywords (for the status line). */
export function relatedCount(run: AskRun): number {
  return expansionsOf(run).reduce((n, e) => n + e.related.length, 0);
}

const quoted = (terms: string[]) => terms.map((t) => `“${t}”`).join(' + ');

/**
 * How a keyword reaches records outside the filters, worded truthfully:
 *   “rebar” appears in 2 records
 *   “damaged” (via related terms: collapse, crack, corrosion) matches 3 records
 *   “crack” (or related terms: collapse) matches 3 records
 */
export function describeReach(run: AskRun, keyword: string): string {
  const n = pluralize(run.keywordReach[keyword] ?? 0, 'record');
  const via = run.keywordVia[keyword];
  if (!via || !via.related.length) return `“${keyword}” appears in ${n}`;
  if (!via.literal) return `“${keyword}” (via related terms: ${via.related.join(', ')}) matches ${n}`;
  return `“${keyword}” (or related terms: ${via.related.join(', ')}) matches ${n}`;
}

/**
 * Which of a keyword's terms a record matched: `“crack”` when it matched as typed, or
 * `“damaged” via “collapse”` (`“helmet” via “hard-hat” + “ppe”`) when only related terms did.
 */
export function matchLabel(asset: MediaAsset, keyword: string): string {
  const variants = matchedVariants(asset, keyword);
  if (!variants.length || variants.includes(keyword)) return `“${keyword}”`;
  return `“${keyword}” via ${quoted(variants)}`;
}

/**
 * Negation is recognised but not applied. Returns the one-line notice for the
 * interpretation row, or null when the question has no negation word.
 */
export function negationNotice(run: AskRun): string | null {
  const { parsed, result } = run;
  const words = parsed.negators ?? [];
  if (!words.length) return null;
  const understood = parsed.understood.map((u) => u.toLowerCase());
  // Negated terms that still shape the results: a matched keyword, or a filter they set.
  const applied = (parsed.negated ?? []).filter(
    (term) =>
      parsed.sites.includes(term) ||
      understood.some((u) => u === term.toLowerCase() || u.startsWith(term.toLowerCase())) ||
      (result.keywords.includes(term) && !result.unmatchedKeywords.includes(term)),
  );
  if (applied.length) return `Negation isn’t parsed — results include records that match ${applied.map((t) => `“${t}”`).join(' or ')}.`;
  return `${words.map((w) => `“${w}”`).join(', ')} ${words.length === 1 ? 'was' : 'were'} ignored — negation isn’t parsed.`;
}

/** Result ids for a question, without timing (safe to use while rendering). */
export function previewQuery(query: string, pool: MediaAsset[], sites: string[], now: number): string[] {
  return runQuery(parseQuery(query, sites, now), pool).hits.map((h) => h.asset.id);
}

export type InterpretationTone = 'filter' | 'keyword' | 'unmatched';

export interface Interpretation {
  key: string;
  label: string;
  tone: InterpretationTone;
  /** For keywords: how the word was matched, or why it is struck through (shown as the chip's tooltip). */
  note?: string;
  /** Related terms searched along with a keyword (disclosed on the chip). */
  related?: string[];
}

/** The question as VisualOps understood it — shown as chips, never applied silently. */
export function interpret(run: AskRun): Interpretation[] {
  const { parsed, result } = run;
  const out: Interpretation[] = [];
  parsed.severities.forEach((s) => out.push({ key: `sev-${s}`, label: `severity: ${s}`, tone: 'filter' }));
  parsed.categories.forEach((c) =>
    out.push({ key: `cat-${c}`, label: `category: ${CATEGORY_LABEL[c].toLowerCase()}`, tone: 'filter' }),
  );
  parsed.sites.forEach((s) => out.push({ key: `site-${s}`, label: `site: ${s}`, tone: 'filter' }));
  parsed.mediaTypes.forEach((m) =>
    out.push({ key: `media-${m}`, label: `media: ${m === 'image' ? 'photos' : 'videos'}`, tone: 'filter' }),
  );
  parsed.statuses.forEach((s) => out.push({ key: `status-${s}`, label: `status: ${s}`, tone: 'filter' }));
  if (parsed.window) out.push({ key: 'window', label: `captured: ${parsed.window.label}`, tone: 'filter' });
  result.keywords.forEach((k) => {
    const unmatched = result.unmatchedKeywords.includes(k);
    const reach = run.keywordReach[k] ?? 0;
    const related = relatedTerms(k);
    const via = run.keywordVia[k];
    let note: string;
    if (unmatched && reach) {
      const records = pluralize(reach, 'record');
      note =
        via && !via.literal
          ? `Matches ${records} only through related terms (${via.related.join(', ')}), none of which match the filters`
          : `Mentioned by ${records}${via?.related.length ? ` (with related terms: ${via.related.join(', ')})` : ''}, none of which match the filters`;
    } else if (unmatched) note = related.length ? 'No record mentions this word or its related terms' : 'No record mentions this word';
    else note = related.length ? `Also searched: ${related.join(', ')}` : 'Matched against tags, titles, file names and locations';
    out.push({ key: `kw-${k}`, label: `“${k}”`, tone: unmatched ? 'unmatched' : 'keyword', note, related: related.length ? related : undefined });
  });
  return out;
}

/** Records for the visual index strip: newest capture first, capped. */
export function indexOrder(pool: MediaAsset[], cap = STRIP_CAP): MediaAsset[] {
  return [...pool].sort((a, b) => +new Date(b.capturedAt) - +new Date(a.capturedAt)).slice(0, cap);
}

/**
 * Whether `text` matches any keyword, decided by the search engine's own matcher
 * (synonyms included): the text is presented to runQuery as a one-tag record.
 * Highlighting therefore agrees exactly with what the search matched.
 */
export function termMatches(text: string, keywords: string[], probe: MediaAsset): boolean {
  if (!keywords.length || text.length < 2) return false;
  const candidate: MediaAsset = { ...probe, tags: [text], title: '', fileName: '', site: '', zone: undefined, finding: undefined };
  return keywords.some(
    (keyword) => runQuery({ raw: '', understood: [], keywords: [keyword], ...NO_FILTERS }, [candidate]).hits.length > 0,
  );
}

export interface Segment {
  text: string;
  hit: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Character ranges covered by multi-word terms ("hot-work" also matches the words
 * "hot work"), which a word-by-word test cannot see.
 */
function phraseRanges(text: string, keywords: string[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const keyword of keywords) {
    for (const term of variantsOf(keyword)) {
      if (!term.includes('-')) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(term).replace(/-/g, '[-\\s]+')}[\\p{L}\\p{N}]*`, 'giu');
      for (const m of text.matchAll(re)) ranges.push([m.index, m.index + m[0].length]);
    }
  }
  return ranges;
}

/** Splits text into runs, flagging the words the query's keywords matched. */
export function highlightSegments(text: string, keywords: string[], probe: MediaAsset): Segment[] {
  if (!keywords.length) return [{ text, hit: false }];
  const phrases = phraseRanges(text, keywords);
  const out: Segment[] = [];
  let at = 0;
  for (const token of text.split(/(\s+)/)) {
    if (!token) continue;
    const start = at;
    at += token.length;
    const space = /^\s+$/.test(token);
    const inPhrase = phrases.some(([from, to]) => start < to && at > from && (!space || (start >= from && at <= to)));
    const core = token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const hit = inPhrase || (!space && termMatches(core, keywords, probe));
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += token;
    else out.push({ text: token, hit });
  }
  return out;
}

export interface Facet {
  key: string;
  label: string;
  query: string;
  count: number;
  severity?: Severity;
}

/** Browse-by shortcuts for the empty state; each count is what the query really returns. */
export function buildFacets(pool: MediaAsset[], sites: string[], now: number): { severity: Facet[]; sites: Facet[]; media: Facet[] } {
  const run = (q: string) => previewQuery(q, pool, sites, now).length;
  return {
    severity: SEVERITIES.map((s) => {
      const query = `${s} issues`;
      return { key: `sev-${s}`, label: s, query, count: run(query), severity: s };
    }),
    sites: sites.map((s) => ({ key: `site-${s}`, label: s, query: s, count: run(s) })),
    media: [
      { key: 'media-image', label: 'Photos', query: 'photos', count: run('photos') },
      { key: 'media-video', label: 'Videos', query: 'videos', count: run('videos') },
    ],
  };
}
