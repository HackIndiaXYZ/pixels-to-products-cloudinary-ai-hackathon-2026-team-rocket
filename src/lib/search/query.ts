import type { Category, FindingStatus, MediaAsset, ResourceType, Severity } from '@/lib/types';
import { pluralize } from '@/lib/format';

/**
 * Ask VisualOps — a transparent query parser.
 *
 * Plain-language questions are turned into explicit filters (severity,
 * category, site, time window, media type, status) plus free-text keywords
 * that are matched against each record's tags, title, finding and file name.
 * There is no language model here: the interpretation is shown to the user as
 * chips so they can see exactly how the question was understood.
 *
 * Words are handled in one of three ways:
 *   - filter words (severity, status, site, time window) become filters and are consumed;
 *   - generic category / media words ("structural", "equipment", "photos") become filters only;
 *   - object nouns that imply a category ("bridge", "helmet", "rebar", "truck") set the category
 *     filter AND stay keywords, so "bridge" ranks the bridge record, not every structural one.
 * Negation ("without helmets") is detected but not inverted: the words that follow it are
 * reported on `ParsedQuery.negated` so the interface can say the results still match them.
 */

export interface DateWindow {
  /** Inclusive lower bound (ms since epoch). */
  from: number;
  /**
   * Exclusive upper bound (ms since epoch). `Number.POSITIVE_INFINITY` for open-ended windows
   * ("today", "this week", "past N days", "past 30 days", "recent"), so media captured after the
   * console read its clock still counts. Finite only for closed windows ("yesterday", "last week").
   */
  to: number;
  label: string;
}

/** The structured filters a question can carry. */
export type FilterKey = 'window' | 'sites' | 'mediaTypes' | 'severities' | 'statuses' | 'categories';

export interface ParsedQuery {
  raw: string;
  severities: Severity[];
  categories: Category[];
  sites: string[];
  mediaTypes: ResourceType[];
  statuses: FindingStatus[];
  window?: DateWindow;
  /** Free-text keywords (stemmed). Generic category and media words are not included: they only filter. */
  keywords: string[];
  /** Tokens the parser recognised (for highlighting). */
  understood: string[];
  /**
   * Terms that directly followed a negation word ("without", "no", "missing", "not", "lacking"),
   * e.g. "people without helmets" → ["helmet"]. Negation is NOT applied: results still include
   * records that match these terms, and the interface should say so. Empty when there is no negation.
   */
  negated?: string[];
  /**
   * The negation words found and ignored ("without", "no", …), even when no term follows them
   * ("sites with no issues"). "not resolved" is understood as a status and is not listed.
   */
  negators?: string[];
  /** Text each structured filter consumed, in normalised (lower-case) form. Used by relaxations(). */
  spans?: Partial<Record<FilterKey, string[]>>;
  /** The clock (ms) the time window was computed against. */
  now?: number;
}

const SEVERITY_WORDS: Array<[RegExp, Severity[]]> = [
  [/\b(critical|crit)\b/, ['critical']],
  // Not inside compounds such as "high-vis" or "low-resolution".
  [/\bhigh(?:[- ](?:severity|risk|priority))?(?![\w-])/, ['high']],
  [/\b(medium|moderate)\b/, ['medium']],
  [/\blow(?:[- ](?:severity|risk|priority))?(?![\w-])/, ['low']],
  [/\b(urgent|severe|serious|major|dangerous)\b/, ['critical', 'high']],
];

const CATEGORY_WORDS: Array<[RegExp, Category]> = [
  [/\b(structural|structure|structures|foundation|slab|beam|beams|bridge|bridges|sinkhole|collapse|rebar|concrete|infrastructure|corrosion|rust|rusted)\b/, 'structural'],
  [/\b(safety|ppe|hazard|hazards|unsafe|slip|trip|fall|falls|harness|harnesses|helmet|helmets|hardhats?|hard-hats?|hot-work|permit)\b/, 'safety'],
  [/\b(equipment|machinery|machine|machines|vehicle|vehicles|fleet|truck|trucks|lorry|lorries|plant equipment|excavator|pipelayers?|sidebooms?|bulldozers?|dozers?|dashboard|mechanical)\b/, 'equipment'],
  [/\b(electrical|electric|power|cable|cables|overhead line|catenary|ole|transformer|substation)\b/, 'electrical'],
  [/\b(facilit(y|ies)|building services|plumbing|washroom|toilet|housekeeping|cleaning|kitchen|cctv)\b/, 'facilities'],
  [/\b(inventory|stock|stores|parts?|tools?|receiving|goods[- ]in|label|labels)\b/, 'inventory'],
];

const STATUS_WORDS: Array<[RegExp, FindingStatus[]]> = [
  // "Unresolved" is everything still needing attention: open + monitoring (the console's meaning).
  [/\b(unresolved|unfixed|not\s+(?:yet\s+)?(?:resolved|closed|fixed|done))\b/, ['open', 'monitoring']],
  [/\b(open|outstanding|pending|active)\b/, ['open']],
  [/\b(monitor(ing|ed)?|watch(list)?)\b/, ['monitoring']],
  [/\b(resolved|closed|fixed|compliant|done)\b/, ['resolved']],
];

const MEDIA_WORDS: Array<[RegExp, ResourceType]> = [
  [/\b(photos?|images?|pictures?|pics?|stills?|snapshots?)\b/, 'image'],
  [/\b(videos?|clips?|footage|recordings?|cctv|drone footage)\b/, 'video'],
];

/** Multi-word terms kept together so they match as one (and are not split into noise like "work"). */
const PHRASES: Array<[RegExp, string]> = [
  [/\bhard[- ]?hats?\b/g, 'hard-hat'],
  [/\bhot[- ]work\b/g, 'hot-work'],
];

const STOPWORDS = new Set(
  (
    'show me all any the a an of in on at from for with within containing contain contains that which ' +
    'have has had is are was were be find list give get display what where who whose please issues issue ' +
    'problems problem findings finding media assets asset evidence items records record inspection inspections ' +
    'and or to by near about this last past week weeks today yesterday month months day days hours hour ' +
    'visual data photo photos image images video videos clips clip footage sites site location locations ' +
    'yet there their it its do does did can could should would will my our we you how many much when why been being into'
  ).split(' '),
);

/** Words that name a category or media type in general: they filter, they never rank. */
const FILTER_ONLY = new Set(
  (
    'structural structure infrastructure safety hazard unsafe equipment machinery machine mechanical ' +
    'electrical electric power facility inventory stock ' +
    'picture pic still snapshot recording'
  ).split(' '),
);

const NEGATORS = new Set(['without', 'no', 'missing', 'not', 'lacking']);
/** Skipped between a negation word and the term it negates ("without any helmets"). */
const NEGATION_SKIP = new Set(['a', 'an', 'the', 'any', 'yet', 'in', 'at', 'from', 'on', 'near', 'for', 'of', 'with']);
/** Continue a negated list ("without helmets or harnesses"). */
const NEGATION_JOIN = new Set(['or', 'and', 'nor']);

/**
 * Related terms searched along with a keyword. Every expansion is disclosed in the
 * interface through variantsOf(), so a match via "collapse" is never presented as
 * a literal match on "damaged".
 */
const SYNONYMS: Record<string, string[]> = {
  crack: ['crack', 'cracking', 'fracture', 'broken-concrete', 'collapse'],
  damage: ['damage', 'damaged', 'broken', 'collapse', 'crack', 'corrosion', 'dent'],
  damaged: ['damage', 'damaged', 'broken', 'collapse', 'crack', 'corrosion', 'dent'],
  leak: ['leak', 'leaking', 'water', 'fluid', 'wet'],
  rust: ['rust', 'corrosion', 'coating'],
  corrosion: ['corrosion', 'rust'],
  construction: ['construction', 'demolition', 'scaffold', 'rebar', 'site'],
  wet: ['wet', 'wet-floor', 'slip-hazard'],
  weld: ['weld', 'welding', 'hot-work'],
  welding: ['welding', 'weld', 'hot-work'],
  'hot-work': ['hot-work', 'welding', 'weld'],
  drone: ['drone', 'aerial'],
  plate: ['plate', 'registration'],
  helmet: ['helmet', 'hard-hat', 'ppe'],
  'hard-hat': ['hard-hat', 'hardhat', 'helmet'],
  hardhat: ['hardhat', 'hard-hat', 'helmet'],
  dozer: ['dozer', 'bulldozer'],
  bulldozer: ['bulldozer', 'dozer'],
  lorry: ['lorry', 'truck'],
  pipelayer: ['pipelayer', 'sideboom'],
  sideboom: ['sideboom', 'pipelayer'],
  cable: ['cable', 'wire', 'catenary', 'overhead-line'],
  camera: ['camera', 'cctv'],
};

/**
 * Every term a keyword is matched with: the keyword itself first, then its related
 * terms. Length 1 means the keyword is matched literally (word-start, no expansion).
 */
export function variantsOf(keyword: string): string[] {
  const related = Object.hasOwn(SYNONYMS, keyword) ? SYNONYMS[keyword] : [];
  return [keyword, ...related.filter((v) => v !== keyword)];
}

/** The related terms a keyword is expanded with (empty when it is matched literally). */
export function relatedTerms(keyword: string): string[] {
  return variantsOf(keyword).slice(1);
}

/** Singularises the last word of a token: "hard-hats" → "hard-hat"; "high-vis" and "gas" stay as typed. */
function stem(token: string): string {
  const cut = token.lastIndexOf('-') + 1;
  const head = token.slice(0, cut);
  const word = token.slice(cut);
  if (word.length > 4 && word.endsWith('ies')) return `${head}${word.slice(0, -3)}y`;
  if (word.length > 3 && /(ss|sh|ch|x)es$/.test(word)) return head + word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return head + word.slice(0, -1);
  return token;
}

/**
 * Lower-cases, turns punctuation into spaces, joins known phrases ("hard hat" → "hard-hat")
 * and pads with single spaces so ` ${term} ` tests whole words.
 */
function normalise(text: string): string {
  let out = ` ${text.toLowerCase().replace(/[“”"'’‘?!.,;:()[\]{}]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  for (const [re, replacement] of PHRASES) out = out.replace(re, replacement);
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Removes every occurrence of `re` from `q` and returns the matched texts. */
function consume(q: string, re: RegExp): { q: string; matched: string[] } {
  const matched: string[] = [];
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const out = q.replace(global, (m) => {
    matched.push(m.trim());
    return ' ';
  });
  return { q: out, matched };
}

function detectWindow(q: string, now: number): { window?: DateWindow; matched?: string } {
  const DAY = 86_400_000;
  const OPEN = Number.POSITIVE_INFINITY;
  const startOfDay = (t: number) => {
    const d = new Date(t);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };
  const monday = () => startOfDay(now) - ((new Date(now).getDay() + 6) % 7) * DAY;

  let m = q.match(/\b(?:last|past)\s+(\d{1,3})\s*(hours?|days?|weeks?)\b/);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2].startsWith('hour') ? 'hour' : m[2].startsWith('week') ? 'week' : 'day';
    const ms = unit === 'hour' ? DAY / 24 : unit === 'week' ? DAY * 7 : DAY;
    return { window: { from: now - n * ms, to: OPEN, label: `past ${pluralize(n, unit)}` }, matched: m[0] };
  }
  if ((m = q.match(/\btoday\b/))) return { window: { from: startOfDay(now), to: OPEN, label: 'today' }, matched: m[0] };
  if ((m = q.match(/\byesterday\b/))) {
    const start = startOfDay(now) - DAY;
    return { window: { from: start, to: start + DAY, label: 'yesterday' }, matched: m[0] };
  }
  if ((m = q.match(/\blast\s+week\b/))) {
    const start = monday();
    return { window: { from: start - 7 * DAY, to: start, label: 'last week' }, matched: m[0] };
  }
  if ((m = q.match(/\bthis\s+week\b/))) return { window: { from: monday(), to: OPEN, label: 'this week' }, matched: m[0] };
  if ((m = q.match(/\bpast\s+week\b/))) return { window: { from: now - 7 * DAY, to: OPEN, label: 'past 7 days' }, matched: m[0] };
  if ((m = q.match(/\b(?:this|past|last)\s+month\b/))) {
    return { window: { from: now - 30 * DAY, to: OPEN, label: 'past 30 days' }, matched: m[0] };
  }
  if ((m = q.match(/\b(?:recent|recently|latest|newest|new)\b/))) {
    return { window: { from: now - 3 * DAY, to: OPEN, label: 'past 72 hours' }, matched: m[0] };
  }
  return {};
}

interface SiteForm {
  site: string;
  /** Normalised spellings without padding, e.g. "building b", "bldg b". */
  forms: string[];
}

function siteForms(knownSites: string[]): SiteForm[] {
  return [...knownSites]
    .sort((a, b) => b.length - a.length)
    .map((site) => {
      const base = normalise(site).trim();
      return { site, forms: Array.from(new Set([base, base.replace(/\bbuilding\b/, 'bldg')])).filter(Boolean) };
    });
}

/**
 * Terms that follow a negation word. Skips articles and prepositions, keeps
 * consecutive content words, continues across "or"/"and", and reports a site
 * name whole. "not resolved" is understood as a status and is not reported.
 */
function negatedTerms(q: string, sites: SiteForm[]): { terms: string[]; words: string[] } {
  const tokens = q.trim().split(' ').filter(Boolean);
  const out: string[] = [];
  const words: string[] = [];
  const siteAt = (j: number): { site: string; length: number } | null => {
    for (const { site, forms } of sites) {
      for (const form of forms) {
        const parts = form.split(' ');
        if (parts.every((p, k) => tokens[j + k] === p)) return { site, length: parts.length };
      }
    }
    return null;
  };
  const content = (t: string | undefined) =>
    t !== undefined && t.length > 1 && !STOPWORDS.has(t) && !NEGATORS.has(t) && !NEGATION_JOIN.has(t) && !/^\d+$/.test(t);

  for (let i = 0; i < tokens.length; i++) {
    if (!NEGATORS.has(tokens[i])) continue;
    let j = i + 1;
    const next = tokens[j] === 'yet' ? tokens[j + 1] : tokens[j];
    if (tokens[i] === 'not' && /^(resolved|closed|fixed|done)$/.test(next ?? '')) continue;
    words.push(tokens[i]);
    while (j < tokens.length && NEGATION_SKIP.has(tokens[j])) j++;
    let taken = 0;
    while (j < tokens.length && taken < 4) {
      const site = siteAt(j);
      if (site) {
        out.push(site.site);
        j += site.length;
      } else if (content(tokens[j])) {
        out.push(stem(tokens[j]));
        j += 1;
      } else {
        break;
      }
      taken += 1;
      if (NEGATION_JOIN.has(tokens[j]) && (content(tokens[j + 1]) || siteAt(j + 1))) j += 1;
    }
    i = Math.max(i, j - 1);
  }
  return { terms: Array.from(new Set(out)), words: Array.from(new Set(words)) };
}

export function parseQuery(input: string, knownSites: string[], now: number = Date.now()): ParsedQuery {
  const raw = input.trim();
  let q = normalise(raw);
  const understood: string[] = [];
  const spans: Partial<Record<FilterKey, string[]>> = {};
  const span = (key: FilterKey, text: string) => (spans[key] ??= []).push(text);

  const forms = siteForms(knownSites);
  const negation = negatedTerms(q, forms);

  // Sites first, so a site named e.g. "High Street" is not read as a severity.
  // Whole words only: "building basement" is not Building B, "plant 20" is not Plant 2
  // ("building-b" is accepted).
  const sites: string[] = [];
  for (const { site, forms: spellings } of forms) {
    for (const form of spellings) {
      const re = new RegExp(` ${form.split(' ').map(escapeRe).join('[ -]')}(?= )`, 'g');
      if (!re.test(q)) continue;
      sites.push(site);
      understood.push(site);
      span('sites', form);
      q = q.replace(re, ' ');
      break;
    }
  }

  const severities = new Set<Severity>();
  for (const [re, values] of SEVERITY_WORDS) {
    const r = consume(q, re);
    if (r.matched.length) {
      values.forEach((v) => severities.add(v));
      r.matched.forEach((m) => {
        understood.push(m);
        span('severities', m);
      });
      q = r.q;
    }
  }

  // Category words are not consumed: object nouns among them stay keywords (see FILTER_ONLY).
  const categories = new Set<Category>();
  for (const [re, category] of CATEGORY_WORDS) {
    const matches = q.match(new RegExp(re.source, 'g'));
    if (matches) {
      categories.add(category);
      matches.forEach((m) => {
        understood.push(m.trim());
        span('categories', m.trim());
      });
    }
  }

  const statuses = new Set<FindingStatus>();
  for (const [re, values] of STATUS_WORDS) {
    const r = consume(q, re);
    if (r.matched.length) {
      values.forEach((v) => statuses.add(v));
      r.matched.forEach((m) => {
        understood.push(m);
        span('statuses', m);
      });
      q = r.q;
    }
  }

  const mediaTypes = new Set<ResourceType>();
  for (const [re, type] of MEDIA_WORDS) {
    const matches = q.match(new RegExp(re.source, 'g'));
    if (matches) {
      mediaTypes.add(type);
      matches.forEach((m) => {
        understood.push(m.trim());
        span('mediaTypes', m.trim());
      });
    }
  }

  const { window, matched } = detectWindow(q, now);
  if (matched) {
    understood.push(matched);
    span('window', matched);
    q = q.replace(matched, ' ');
  }

  const keywords = Array.from(
    new Set(
      q
        .split(' ')
        .map((t) => t.trim())
        .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !NEGATORS.has(t) && !/^\d+$/.test(t))
        .map(stem)
        .filter((t) => !FILTER_ONLY.has(t)),
    ),
  );

  return {
    raw,
    severities: Array.from(severities),
    categories: Array.from(categories),
    sites: Array.from(new Set(sites)),
    mediaTypes: Array.from(mediaTypes),
    statuses: Array.from(statuses),
    window,
    keywords,
    understood: Array.from(new Set(understood)),
    negated: negation.terms,
    negators: negation.words,
    spans,
    now,
  };
}

export interface SearchHit {
  asset: MediaAsset;
  score: number;
  matched: string[];
}

export interface SearchResult {
  hits: SearchHit[];
  /** Free-text keywords actually used for matching (generic category and media words only filter). */
  keywords: string[];
  /** Keywords that matched no record — surfaced honestly instead of silently dropped. */
  unmatchedKeywords: string[];
  /** True when keywords matched nothing and results rely on structured filters only. */
  relaxed: boolean;
}

/**
 * Keywords match descriptors only (tags, titles, file, location, category) —
 * not free-text observations, which contain negations such as "no damage visible".
 */
function haystack(asset: MediaAsset): string[] {
  const f = asset.finding;
  return [...asset.tags, asset.title, asset.fileName, asset.site, asset.zone ?? '', f?.title ?? '', f?.category ?? ''].map((s) =>
    s.toLowerCase(),
  );
}

/**
 * Word-start matching: "crack" finds "cracked", but "dent" never matches "identifiable".
 * A hyphen in a term also matches a space ("hot-work" finds "hot work").
 */
function termPattern(term: string): RegExp {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(term).replace(/-/g, '[-\\s]')}`, 'u');
}

function keywordMatcher(keyword: string): (hay: string[]) => string[] {
  const patterns = variantsOf(keyword).map((v) => [v, termPattern(v)] as const);
  return (hay) => patterns.filter(([, re]) => hay.some((h) => re.test(h))).map(([v]) => v);
}

/**
 * Which of a keyword's variants (the keyword itself and its related terms) a record matches.
 * Use it to disclose "via related terms" matches truthfully.
 */
export function matchedVariants(asset: MediaAsset, keyword: string): string[] {
  return keywordMatcher(keyword)(haystack(asset));
}

function isFilterWord(keyword: string): boolean {
  return FILTER_ONLY.has(keyword) || NEGATORS.has(keyword);
}

export function runQuery(parsed: ParsedQuery, assets: MediaAsset[]): SearchResult {
  const filtered = assets.filter((asset) => {
    const f = asset.finding;
    if (parsed.severities.length && (!f || !parsed.severities.includes(f.severity))) return false;
    if (parsed.statuses.length && (!f || !parsed.statuses.includes(f.status))) return false;
    if (parsed.sites.length && !parsed.sites.includes(asset.site)) return false;
    if (parsed.mediaTypes.length === 1 && asset.resourceType !== parsed.mediaTypes[0]) return false;
    if (parsed.categories.length && (!f || !parsed.categories.includes(f.category))) return false;
    if (parsed.window) {
      const t = new Date(asset.capturedAt).getTime();
      if (t < parsed.window.from || t >= parsed.window.to) return false;
    }
    return true;
  });

  // Generic category/media words and negation words only filter; object nouns ("bridge") rank.
  const keywords = Array.from(new Set(parsed.keywords.filter((k) => !isFilterWord(k))));
  const matchers = keywords.map((k) => [k, keywordMatcher(k)] as const);

  const scored: SearchHit[] = filtered.map((asset) => {
    const hay = haystack(asset);
    const matched = matchers.filter(([, match]) => match(hay).length > 0).map(([k]) => k);
    const severityBoost = { critical: 0.4, high: 0.3, medium: 0.2, low: 0.1 }[asset.finding?.severity ?? 'low'];
    return { asset, matched, score: matched.length * 2 + severityBoost };
  });

  const unmatchedKeywords = keywords.filter((k) => !scored.some((h) => h.matched.includes(k)));
  const anyKeywordHit = scored.some((h) => h.matched.length > 0);
  const hasStructured = activeFilters(parsed).length > 0;

  let hits = scored;
  let relaxed = false;
  if (keywords.length) {
    if (anyKeywordHit) {
      hits = scored.filter((h) => h.matched.length > 0);
    } else if (hasStructured) {
      relaxed = true; // keep structured results, report the unmatched keywords
    } else {
      hits = [];
    }
  }

  hits.sort((a, b) => b.score - a.score || +new Date(b.asset.capturedAt) - +new Date(a.asset.capturedAt));
  return { hits, keywords, unmatchedKeywords, relaxed };
}

/* ------------------------------------------------------------------------ */
/* Relaxations — what to drop when a question returns nothing                */
/* ------------------------------------------------------------------------ */

const FILTER_ORDER: FilterKey[] = ['window', 'sites', 'mediaTypes', 'severities', 'statuses', 'categories'];

function activeFilters(parsed: ParsedQuery): FilterKey[] {
  return FILTER_ORDER.filter((key) => (key === 'window' ? Boolean(parsed.window) : parsed[key].length > 0));
}

/** A filter worded like the Understanding chips: "captured: last week", "site: Plant 2". */
export function filterLabel(parsed: ParsedQuery, key: FilterKey): string {
  switch (key) {
    case 'window':
      return `captured: ${parsed.window?.label ?? ''}`;
    case 'sites':
      return `site: ${parsed.sites.join(', ')}`;
    case 'mediaTypes':
      return `media: ${parsed.mediaTypes.map((m) => (m === 'image' ? 'photos' : 'videos')).join(', ')}`;
    case 'severities':
      return `severity: ${parsed.severities.join(', ')}`;
    case 'statuses':
      return `status: ${parsed.statuses.join(', ')}`;
    case 'categories':
      return `category: ${parsed.categories.join(', ')}`;
  }
}

export interface Relaxation {
  /** Stable key for rendering, e.g. "drop-window" or "widen-window". */
  key: string;
  /** The filter dropped or widened. */
  filter: FilterKey;
  /** `drop` removes the filter; `widen` replaces a calendar window with the rolling past 7 days. */
  kind: 'drop' | 'widen';
  /** The filter as the chips word it, e.g. "captured: last week". */
  filterLabel: string;
  /** Human label: "Without captured: last week", or "Captured: past 7 days" for a widened window. */
  label: string;
  /** Records the relaxed question returns (always > 0). */
  hits: number;
  /** The relaxed question as a parse, ready for runQuery(). */
  parsed: ParsedQuery;
  /**
   * The question reworded so that parseQuery() reproduces exactly this result set
   * (checked by re-running it). Undefined when the words cannot be separated, e.g.
   * dropping the category a keyword like "bridge" implies.
   */
  query?: string;
}

const PREPOSITIONS = 'from|in|at|on|during|within|for|of|over|since|near|by|between';
/** A preposition left with nothing to govern: followed by another preposition, or at the end. */
const DANGLING = new RegExp(`\\b(?:${PREPOSITIONS})(?:\\s+(?=(?:${PREPOSITIONS})\\b)|\\s*$)`, 'gi');
const LEADING = new RegExp(`^(?:${PREPOSITIONS})\\s+`, 'i');

/** Removes a normalised span ("last week", "bldg b") from the raw question, whatever its casing and punctuation. */
function removeSpan(text: string, spanText: string, replacement = ' '): string | null {
  const words = spanText.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(escapeRe);
  if (!words.length) return null;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${words.join('[^\\p{L}\\p{N}]+')}(?![\\p{L}\\p{N}])`, 'giu');
  if (!re.test(text)) return null;
  re.lastIndex = 0;
  return text.replace(re, replacement);
}

function tidy(text: string): string {
  let out = text.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) out = out.replace(DANGLING, '').replace(/\s+/g, ' ').trim();
  return out.replace(LEADING, '').replace(/\s+([,.;:?!])/g, '$1').trim();
}

function sameIds(a: SearchResult, b: SearchResult): boolean {
  if (a.hits.length !== b.hits.length) return false;
  const ids = new Set(a.hits.map((h) => h.asset.id));
  return b.hits.every((h) => ids.has(h.asset.id));
}

/**
 * When a question returns nothing: for each structured filter, how many records the
 * question returns without it ("Without captured: last week → 2 records"), plus a rolling
 * "past 7 days" alternative for calendar windows. Only relaxations that return records
 * (with the question's keywords genuinely matching, when it has any) are listed.
 *
 * `options.sites` / `options.now` are used to verify the reworded `query`; they default to
 * the pool's sites and the clock the question was parsed with.
 */
export function relaxations(
  parsed: ParsedQuery,
  assets: MediaAsset[],
  options: { sites?: string[]; now?: number } = {},
): Relaxation[] {
  const now = options.now ?? parsed.now ?? Date.now();
  const sites = options.sites ?? Array.from(new Set(assets.map((a) => a.site)));
  const out: Relaxation[] = [];

  const consider = (key: string, filter: FilterKey, kind: Relaxation['kind'], next: ParsedQuery, label: string, rewrite: string | null) => {
    if (activeFilters(next).length === 0 && next.keywords.length === 0) return; // "everything" is not a suggestion
    const result = runQuery(next, assets);
    if (!result.hits.length || result.relaxed) return;
    let query: string | undefined;
    if (rewrite !== null) {
      const candidate = tidy(rewrite);
      if (candidate && sameIds(runQuery(parseQuery(candidate, sites, now), assets), result)) query = candidate;
    }
    out.push({ key, filter, kind, filterLabel: filterLabel(parsed, filter), label, hits: result.hits.length, parsed: next, query });
  };

  const rewriteWithout = (filter: FilterKey, replacement = ' '): string | null => {
    const texts = parsed.spans?.[filter] ?? [];
    if (!texts.length) return null;
    let text: string | null = parsed.raw;
    for (const t of texts) {
      text = text === null ? null : removeSpan(text, t, replacement);
      replacement = ' ';
    }
    return text;
  };

  for (const filter of activeFilters(parsed)) {
    if (filter === 'window' && parsed.window && ['today', 'yesterday', 'this week', 'last week'].includes(parsed.window.label)) {
      const widened: DateWindow = { from: now - 7 * 86_400_000, to: Number.POSITIVE_INFINITY, label: 'past 7 days' };
      consider(
        'widen-window',
        'window',
        'widen',
        { ...parsed, window: widened, spans: { ...parsed.spans, window: ['past 7 days'] } },
        'Captured: past 7 days',
        rewriteWithout('window', ' past 7 days '),
      );
    }
    const next: ParsedQuery =
      filter === 'window'
        ? { ...parsed, window: undefined, spans: { ...parsed.spans, window: [] } }
        : { ...parsed, [filter]: [], spans: { ...parsed.spans, [filter]: [] } };
    consider(`drop-${filter}`, filter, 'drop', next, `Without ${filterLabel(parsed, filter)}`, rewriteWithout(filter));
  }
  return out;
}

export const EXAMPLE_QUERIES = [
  'Show all damaged equipment',
  'Find construction photos containing cracks',
  'Show high severity issues from Building B',
  'Find all inspection media from this week',
];
