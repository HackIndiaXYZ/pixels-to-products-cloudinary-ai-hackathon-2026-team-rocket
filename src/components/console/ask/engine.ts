import type { MediaAsset, Severity } from '@/lib/types';
import { CATEGORY_LABEL, SEVERITIES } from '@/lib/analytics';
import { pluralize } from '@/lib/format';
import {
  EXAMPLE_QUERIES,
  FIELD_LABEL,
  FIELD_SOURCE,
  keywordMatch,
  matchSourceOf,
  matchedVariants,
  parseQuery,
  relatedTerms,
  runQuery,
  variantsOf,
  type KeywordMatch,
  type MatchField,
  type MatchSource,
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
 *                                many records each side matches on its own (keywords
 *                                over human-classified fields and Cloudinary's AI
 *                                understanding, each match attributed to its source)
 *   03 Filtering evidence      → runQuery(): filters and keywords combined
 *   04 Results                 → the ranked hits
 *
 * The work itself takes well under a millisecond; the palette only paces the
 * presentation of each stage (≤ STAGE_MS) so the interpretation can be read.
 */

export const ASK_EXAMPLES: readonly string[] = EXAMPLE_QUERIES;

const EXAMPLE_FINDING = 'VO-1042';

/**
 * The example questions for this workspace. The finding-ID example names VO-1042 when a record
 * carries it; otherwise it names the most severe finding the workspace does have, so the example
 * always demonstrates a real lookup instead of an empty result.
 */
export function examplesFor(pool: MediaAsset[]): string[] {
  const annotated = pool.filter((a) => a.finding);
  if (!annotated.length || annotated.some((a) => a.finding?.id === EXAMPLE_FINDING)) return [...ASK_EXAMPLES];
  const rank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const lead = [...annotated].sort(
    (a, b) =>
      rank[b.finding?.severity ?? 'low'] - rank[a.finding?.severity ?? 'low'] || +new Date(b.capturedAt) - +new Date(a.capturedAt),
  )[0];
  const id = lead?.finding?.id;
  return ASK_EXAMPLES.map((q) => (id ? q.replace(EXAMPLE_FINDING, id) : q));
}

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
  /**
   * Per keyword: how many records (ignoring the structured filters) it reaches only through
   * Cloudinary's AI understanding — caption, detected objects, auto-tags — and in which AI fields.
   */
  keywordAi: Record<string, { records: number; fields: MatchField[] }>;
  /** Results that matched at least one keyword only through Cloudinary's AI understanding. */
  aiHits: number;
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
  const keywordAi: Record<string, { records: number; fields: MatchField[] }> = {};
  for (const keyword of result.keywords) {
    const { hits } = runQuery({ ...parsed, ...NO_FILTERS, keywords: [keyword], understood: [] }, pool);
    keywordReach[keyword] = hits.length;
    if (relatedTerms(keyword).length) {
      const seen = new Set(hits.flatMap((h) => matchedVariants(h.asset, keyword)));
      keywordVia[keyword] = { literal: seen.has(keyword), related: relatedTerms(keyword).filter((v) => seen.has(v)) };
    }
    const aiOnly = hits
      .map((h) => h.matches.find((m) => m.keyword === keyword))
      .filter((m): m is KeywordMatch => m !== undefined && matchSourceOf(m) === 'ai');
    if (aiOnly.length) keywordAi[keyword] = { records: aiOnly.length, fields: aiFieldsOf(aiOnly) };
  }
  const aiHits = result.hits.filter((h) => h.matches.some((m) => matchSourceOf(m) === 'ai')).length;
  const ms = performance.now() - t0;
  return {
    id,
    query,
    parsed,
    result,
    hitIds: idsOf(result),
    filterIds,
    keywordIds,
    keywordReach,
    keywordVia,
    keywordAi,
    aiHits,
    filterCount,
    ms,
  };
}

const AI_FIELDS: MatchField[] = ['ai-caption', 'ai-object', 'ai-tag'];

/** The AI fields a set of matches used, in display order. */
function aiFieldsOf(matches: KeywordMatch[]): MatchField[] {
  const used = new Set(matches.flatMap((m) => m.fields));
  return AI_FIELDS.filter((f) => used.has(f));
}

/** "caption", "detected object + auto-tag" — the fields a match used, worded for the interface. */
export function fieldsLabel(fields: MatchField[]): string {
  return fields.map((f) => FIELD_LABEL[f]).join(' + ');
}

/** A keyword's match on a record, split by source: which human fields and which AI fields it matched. */
export interface SourcedMatch {
  keyword: string;
  /** How the term was matched: “crack”, or “damaged” via “collapse”. */
  label: string;
  source: MatchSource | 'both';
  humanFields: MatchField[];
  aiFields: MatchField[];
}

/** Every keyword a record matches, with where it matched (human-classified fields vs Cloudinary's AI). */
export function sourcedMatches(asset: MediaAsset, keywords: string[]): SourcedMatch[] {
  return keywords
    .map((keyword) => keywordMatch(asset, keyword))
    .filter((m) => m.variants.length > 0)
    .map((m) => ({
      keyword: m.keyword,
      label: matchLabel(asset, m.keyword),
      source: matchSourceOf(m),
      humanFields: m.fields.filter((f) => FIELD_SOURCE[f] === 'human'),
      aiFields: m.fields.filter((f) => FIELD_SOURCE[f] === 'ai'),
    }));
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
  /** For keywords: records reached only through Cloudinary's AI understanding (disclosed on the chip). */
  ai?: number;
}

/** What a keyword is matched against (the keyword chips' tooltip). */
export const KEYWORD_FIELDS =
  'Matched against human-classified tags, titles, finding IDs, file names and locations, and Cloudinary AI captions, detected objects and auto-tags';

/** The question as VisualOps understood it — shown as chips, never applied silently. */
export function interpret(run: AskRun): Interpretation[] {
  const { parsed, result } = run;
  const out: Interpretation[] = [];
  parsed.severities.forEach((s) => out.push({ key: `sev-${s}`, label: `severity: ${s}`, tone: 'filter' }));
  parsed.categories.forEach((c) => {
    const nouns = parsed.impliedCategories?.[c];
    out.push({
      key: `cat-${c}`,
      label: `category: ${CATEGORY_LABEL[c].toLowerCase()}`,
      tone: 'filter',
      note: nouns?.length
        ? `Implied by ${nouns.map((n) => `“${n}”`).join(', ')} — records that mention ${nouns.length === 1 ? 'it' : 'them'} (human classified or AI detected) are kept whatever their category`
        : 'Matched against each finding’s human-classified category',
    });
  });
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
    else note = related.length ? `Also searched: ${related.join(', ')}` : KEYWORD_FIELDS;
    const ai = unmatched ? undefined : run.keywordAi[k];
    if (ai) note += ` · ${pluralize(ai.records, 'record')} only through Cloudinary AI (${fieldsLabel(ai.fields)})`;
    out.push({
      key: `kw-${k}`,
      // Finding IDs read as written on the record (VO-1042); matching is case-insensitive either way.
      label: `“${/^vo-[a-z0-9-]+$/.test(k) ? k.toUpperCase() : k}”`,
      tone: unmatched ? 'unmatched' : 'keyword',
      note,
      related: related.length ? related : undefined,
      ai: ai?.records,
    });
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
  // Only the text itself: without the probe's AI understanding, or every word would light up.
  const candidate: MediaAsset = {
    ...probe,
    tags: [text],
    title: '',
    fileName: '',
    site: '',
    zone: undefined,
    finding: undefined,
    ai: undefined,
  };
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
