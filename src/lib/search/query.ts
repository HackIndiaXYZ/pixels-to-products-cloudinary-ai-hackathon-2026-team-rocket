import type { Category, FindingStatus, MediaAsset, ResourceType, Severity } from '@/lib/types';
import { pluralize } from '@/lib/format';

/**
 * Ask VisualOps — a transparent query parser.
 *
 * Plain-language questions are turned into explicit filters (severity,
 * category, site, time window, media type, status) plus free-text keywords.
 * Keywords are matched against two kinds of fields, and every match says which:
 *   - HUMAN CLASSIFIED: the record's tags, title, finding title and ID, file name,
 *     site, zone and category (entered at ingest, or team-written sample annotations);
 *   - AI DETECTED: Cloudinary's AI understanding of the media — its caption, the
 *     objects it detected and the tags its auto-tagging added (see lib/cloudinary/ai).
 * There is no language model here: the interpretation is shown to the user as
 * chips so they can see exactly how the question was understood.
 *
 * Words are handled in one of three ways:
 *   - filter words (severity, status, site, time window) become filters and are consumed;
 *   - generic category / media words ("structural", "equipment", "photos") become filters only;
 *   - object nouns that imply a category ("bridge", "helmet", "rebar", "truck") set the category
 *     filter AND stay keywords, so "bridge" ranks the bridge record, not every structural one.
 *     A category set only by such nouns is soft: a record that mentions the noun itself (in its
 *     record or in Cloudinary's AI understanding) passes it whatever its own category, so
 *     "trucks" also finds a road photo in which Cloudinary detected a truck.
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
  /**
   * Categories set only by object nouns, with the (stemmed) nouns that set them, e.g.
   * `{ equipment: ['truck'] }` for "trucks". Such a category is soft: a record that mentions one of
   * its nouns passes the category filter whatever its own category. A category set by a generic
   * word ("structural", "safety") is absent here and always filters.
   */
  impliedCategories?: Partial<Record<Category, string[]>>;
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
    'yet there their it its do does did can could should would will my our we you how many much when why been being into ' +
    // Words that only frame the question ("safety incidents", "related to VO-1042"): nothing to match.
    'incident incidents related relating regarding concerning involving linked associated showing'
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
  // A category named by a generic word is hard; one set only by object nouns is soft (see ParsedQuery).
  const categories = new Set<Category>();
  const impliedCategories: Partial<Record<Category, string[]>> = {};
  for (const [re, category] of CATEGORY_WORDS) {
    const matches = q.match(new RegExp(re.source, 'g'));
    if (matches) {
      categories.add(category);
      const nouns: string[] = [];
      let generic = false;
      matches.forEach((m) => {
        const text = m.trim();
        understood.push(text);
        span('categories', text);
        const words = text.split(/\s+/).map(stem);
        if (words.some((w) => FILTER_ONLY.has(w))) generic = true;
        else nouns.push(words.join(' '));
      });
      if (!generic && nouns.length) impliedCategories[category] = Array.from(new Set(nouns));
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
    impliedCategories,
    spans,
    now,
  };
}

/**
 * Where a keyword matched. Human-classified fields come from the record (entered at ingest, or
 * team-written sample annotations); AI fields come from Cloudinary's AI Content Analysis.
 */
export type MatchField =
  | 'tag'
  | 'title'
  | 'finding'
  | 'finding-id'
  | 'file'
  | 'site'
  | 'zone'
  | 'category'
  | 'ai-caption'
  | 'ai-object'
  | 'ai-tag';

/** `human`: classified by a person; `ai`: detected by Cloudinary's AI. */
export type MatchSource = 'human' | 'ai';

export const FIELD_SOURCE: Record<MatchField, MatchSource> = {
  tag: 'human',
  title: 'human',
  finding: 'human',
  'finding-id': 'human',
  file: 'human',
  site: 'human',
  zone: 'human',
  category: 'human',
  'ai-caption': 'ai',
  'ai-object': 'ai',
  'ai-tag': 'ai',
};

export const FIELD_LABEL: Record<MatchField, string> = {
  tag: 'tag',
  title: 'title',
  finding: 'finding title',
  'finding-id': 'finding ID',
  file: 'file name',
  site: 'site',
  zone: 'zone',
  category: 'category',
  'ai-caption': 'caption',
  'ai-object': 'detected object',
  'ai-tag': 'auto-tag',
};

/** How one keyword matched one record. */
export interface KeywordMatch {
  keyword: string;
  /** The keyword's terms that matched (the keyword itself and/or its related terms), in search order. */
  variants: string[];
  /** The fields they matched in, human-classified fields first. */
  fields: MatchField[];
}

export interface SearchHit {
  asset: MediaAsset;
  score: number;
  /** Keywords the record matched. */
  matched: string[];
  /** Per matched keyword: which terms matched, and in which fields (human classified or AI detected). */
  matches: KeywordMatch[];
}

/** Which sources a keyword match came from: only the record, only Cloudinary's AI, or both. */
export function matchSourceOf(match: Pick<KeywordMatch, 'fields'>): MatchSource | 'both' {
  const human = match.fields.some((f) => FIELD_SOURCE[f] === 'human');
  const ai = match.fields.some((f) => FIELD_SOURCE[f] === 'ai');
  return human && ai ? 'both' : ai ? 'ai' : 'human';
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

interface HayEntry {
  text: string;
  field: MatchField;
}

const hayCache = new WeakMap<MediaAsset, HayEntry[]>();

/**
 * What keywords are matched against. From the record: descriptors only (tags, titles, finding ID,
 * file, location, category) — not free-text observations, which contain negations such as "no
 * damage visible". From Cloudinary's AI: its one-sentence caption of what is in frame, the object
 * labels it detected and the tags its auto-tagging added. A tag listed in `ai.tags` was added by
 * Cloudinary, so it counts as AI detected even though it also sits on the asset's tags.
 */
function haystack(asset: MediaAsset): HayEntry[] {
  const cached = hayCache.get(asset);
  if (cached) return cached;
  const out: HayEntry[] = [];
  const push = (text: string | undefined, field: MatchField) => {
    const t = text?.trim().toLowerCase();
    if (t) out.push({ text: t, field });
  };
  const f = asset.finding;
  const ai = asset.ai;
  const aiTags = new Set((ai?.tags ?? []).map((t) => t.toLowerCase()));
  for (const tag of asset.tags) push(tag, aiTags.has(tag.toLowerCase()) ? 'ai-tag' : 'tag');
  push(asset.title, 'title');
  push(asset.fileName, 'file');
  push(asset.site, 'site');
  push(asset.zone, 'zone');
  if (f) {
    push(f.title, 'finding');
    push(f.id, 'finding-id');
    push(f.category, 'category');
  }
  if (ai) {
    push(ai.caption, 'ai-caption');
    for (const o of ai.objects) push(o.label, 'ai-object');
    const onAsset = new Set(asset.tags.map((t) => t.toLowerCase()));
    for (const tag of ai.tags) if (!onAsset.has(tag.toLowerCase())) push(tag, 'ai-tag');
  }
  hayCache.set(asset, out);
  return out;
}

/**
 * Word-start matching: "crack" finds "cracked", but "dent" never matches "identifiable".
 * A hyphen or space in a term also matches the other ("hot-work" finds "hot work").
 */
function termPattern(term: string): RegExp {
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRe(term).replace(/[-\s]+/g, '[-\\s]')}`, 'u');
}

const FIELD_ORDER = Object.keys(FIELD_SOURCE) as MatchField[];

function keywordMatcher(keyword: string): (hay: HayEntry[]) => KeywordMatch {
  const patterns = variantsOf(keyword).map((v) => [v, termPattern(v)] as const);
  return (hay) => {
    const variants: string[] = [];
    const fields = new Set<MatchField>();
    for (const [variant, re] of patterns) {
      let hit = false;
      for (const entry of hay) {
        if (!re.test(entry.text)) continue;
        hit = true;
        fields.add(entry.field);
      }
      if (hit) variants.push(variant);
    }
    return { keyword, variants, fields: FIELD_ORDER.filter((f) => fields.has(f)) };
  };
}

/**
 * Which of a keyword's variants (the keyword itself and its related terms) a record matches.
 * Use it to disclose "via related terms" matches truthfully.
 */
export function matchedVariants(asset: MediaAsset, keyword: string): string[] {
  return keywordMatcher(keyword)(haystack(asset)).variants;
}

/** How `keyword` matches `asset`: its matching terms and the fields they matched in (none when it does not match). */
export function keywordMatch(asset: MediaAsset, keyword: string): KeywordMatch {
  return keywordMatcher(keyword)(haystack(asset));
}

/** Whether a soft category's noun ("truck") is mentioned anywhere on the record, human or AI. */
function mentionsAny(hay: HayEntry[], nouns: string[]): boolean {
  return nouns.some((noun) => keywordMatcher(noun)(hay).variants.length > 0);
}

function isFilterWord(keyword: string): boolean {
  return FILTER_ONLY.has(keyword) || NEGATORS.has(keyword);
}

/**
 * The category filter. A category named by a generic word must match the record's own finding.
 * When every category was set only by object nouns ("trucks"), a record that mentions one of those
 * nouns anywhere — its record or Cloudinary's AI understanding — passes as well.
 */
function passesCategory(parsed: ParsedQuery, asset: MediaAsset): boolean {
  if (!parsed.categories.length) return true;
  const f = asset.finding;
  if (f && parsed.categories.includes(f.category)) return true;
  const implied = parsed.impliedCategories ?? {};
  if (!parsed.categories.every((c) => implied[c]?.length)) return false;
  return mentionsAny(
    haystack(asset),
    parsed.categories.flatMap((c) => implied[c] ?? []),
  );
}

export function runQuery(parsed: ParsedQuery, assets: MediaAsset[]): SearchResult {
  const filtered = assets.filter((asset) => {
    const f = asset.finding;
    if (parsed.severities.length && (!f || !parsed.severities.includes(f.severity))) return false;
    if (parsed.statuses.length && (!f || !parsed.statuses.includes(f.status))) return false;
    if (parsed.sites.length && !parsed.sites.includes(asset.site)) return false;
    if (parsed.mediaTypes.length === 1 && asset.resourceType !== parsed.mediaTypes[0]) return false;
    if (!passesCategory(parsed, asset)) return false;
    if (parsed.window) {
      const t = new Date(asset.capturedAt).getTime();
      if (t < parsed.window.from || t >= parsed.window.to) return false;
    }
    return true;
  });

  // Generic category/media words and negation words only filter; object nouns ("bridge") rank.
  const keywords = Array.from(new Set(parsed.keywords.filter((k) => !isFilterWord(k))));
  const matchers = keywords.map((k) => keywordMatcher(k));

  const scored: SearchHit[] = filtered.map((asset) => {
    const hay = haystack(asset);
    const matches = matchers.map((match) => match(hay)).filter((m) => m.variants.length > 0);
    const matched = matches.map((m) => m.keyword);
    const severityBoost = { critical: 0.4, high: 0.3, medium: 0.2, low: 0.1 }[asset.finding?.severity ?? 'low'];
    return { asset, matched, matches, score: matched.length * 2 + severityBoost };
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
        : filter === 'categories'
          ? { ...parsed, categories: [], impliedCategories: {}, spans: { ...parsed.spans, categories: [] } }
          : { ...parsed, [filter]: [], spans: { ...parsed.spans, [filter]: [] } };
    consider(`drop-${filter}`, filter, 'drop', next, `Without ${filterLabel(parsed, filter)}`, rewriteWithout(filter));
  }
  return out;
}

/**
 * Questions the console offers as examples. Each is answered by the parser above — filters from
 * the record, keywords over the record and Cloudinary's AI understanding — and the palette shows
 * how many records each really returns in the current workspace. The finding-ID question is
 * rewritten to a finding that exists in the workspace when VO-1042 does not (see Ask's engine).
 */
export const EXAMPLE_QUERIES = [
  'Show severe structural findings',
  'Find bridge inspection media',
  'Show images with cracks',
  'Find recent safety incidents',
  'sinkhole',
  'trucks',
  'Show evidence related to VO-1042',
];
