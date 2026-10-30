/**
 * Topic autocomplete for the QBank composer.
 *
 * Students type short, broad and often misspelled topics ("cardio",
 * "pediatrcs", "luekemia", "dka" — live data, 2026-10-30). This matches what
 * they type against three sources — their own topics, the 183 curriculum
 * topics, and whole systems — forgivingly enough to catch a typo, and never
 * blocks free text: anything medical is still a valid topic.
 */

export type TopicSource = "library" | "curriculum" | "family" | "system";

export interface TopicOption {
  /** What becomes the chip, and what the generator is asked for. */
  title: string;
  /** The system's display name, when known — shown on the chip. */
  systemName: string | null;
  /** The system key, when known, so the generator can skip routing it. */
  systemKey: string | null;
  source: TopicSource;
}

/** Lowercase words, punctuation flattened. */
export function normalizeTopic(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .trim();
}

/**
 * The abbreviations students actually type, mapped to words that appear in the
 * curriculum titles. Small on purpose: only the ones that would otherwise
 * match nothing.
 */
const ALIASES: Record<string, string> = {
  dka: "diabetic ketoacidosis",
  hhs: "hyperosmolar",
  mi: "acute coronary syndrome",
  acs: "acute coronary syndrome",
  stemi: "acute coronary syndrome",
  chf: "heart failure",
  hf: "heart failure",
  hfref: "heart failure hfref",
  hfpef: "heart failure hfpef",
  afib: "atrial fibrillation",
  af: "atrial fibrillation",
  copd: "copd",
  pe: "pulmonary embolism",
  dvt: "thrombotic disorders",
  aki: "acute kidney injury",
  ckd: "chronic kidney disease",
  uti: "urinary tract infections",
  sle: "systemic lupus erythematosus",
  lupus: "systemic lupus erythematosus",
  ra: "rheumatoid arthritis",
  ms: "multiple sclerosis",
  gbs: "guillain barre",
  ibd: "inflammatory bowel disease",
  uc: "ulcerative colitis",
  gerd: "gastroesophageal reflux",
  pud: "peptic ulcer",
  sbo: "intestinal obstruction",
  aaa: "aortic aneurysm",
  sah: "hemorrhagic stroke",
  tb: "tuberculosis",
  hiv: "hiv aids",
  pcos: "polycystic ovary",
  cad: "stable ischemic heart disease",
  htn: "hypertension",
  spikes: "breaking bad news",
  stats: "biostatistics",
  biostats: "biostatistics",
  ethics: "communication ethics",
  peds: "pediatrics",
  paeds: "pediatrics",
  cardio: "cardiovascular",
  cardiology: "cardiovascular",
  heart: "cardiovascular",
  neuro: "neurology",
  gi: "gastrointestinal",
  renal: "renal",
  kidney: "renal",
  heme: "hematology",
  onc: "oncology",
  psych: "psychiatry",
  obgyn: "obstetrics gynecology",
  derm: "skin",
  id: "infectious disease",
  endo: "endocrinology",
};

/** Edit distance with transpositions, stopping early past `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    prev2.splice(0, prev2.length, ...prev);
    prev = cur;
  }
  return prev[b.length];
}

/** Typos a word may carry and still match: none under four letters. */
const allowedEdits = (word: string) => (word.length >= 8 ? 2 : word.length >= 4 ? 1 : 0);

/**
 * How well `query` matches `title`, 0 for no match.
 *  100 whole title · 90 title starts with it · 80 every query word starts a
 *  title word · 60 substring · 40 every query word within a typo of a title word.
 */
export function matchScore(query: string, title: string): number {
  const q = normalizeTopic(query);
  if (!q) return 0;
  const t = normalizeTopic(title);
  if (t === q) return 100;
  if (t.startsWith(q)) return 90;
  const qWords = q.split(" ");
  const tWords = t.split(" ");
  if (qWords.every((w) => tWords.some((tw) => tw.startsWith(w)))) return 80;
  if (q.length >= 3 && t.includes(q)) return 60;
  const fuzzy = qWords.every((w) => {
    const max = allowedEdits(w);
    return max > 0 && tWords.some((tw) => editDistance(w, tw.slice(0, Math.max(w.length, tw.length)), max) <= max);
  });
  return fuzzy ? 40 : 0;
}

const SOURCE_BOOST: Record<TopicSource, number> = { library: 12, system: 6, family: 4, curriculum: 0 };

/** The query with any known abbreviation expanded, plus the query itself. */
function queryVariants(query: string): string[] {
  const q = normalizeTopic(query);
  const alias = ALIASES[q];
  return alias ? [q, alias] : [q];
}

/**
 * The best matches for what the student is typing, best first. Topics already
 * chosen are left out; duplicates by title are collapsed (the library copy of a
 * topic wins over the curriculum one).
 */
export function suggestTopics(
  query: string,
  options: TopicOption[],
  opts: { exclude?: string[]; limit?: number } = {}
): TopicOption[] {
  const limit = opts.limit ?? 6;
  const excluded = new Set((opts.exclude ?? []).map(normalizeTopic));
  const variants = queryVariants(query);
  if (!variants[0]) return [];

  const scored: { option: TopicOption; score: number }[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    const key = normalizeTopic(option.title);
    if (excluded.has(key)) continue;
    const base = Math.max(...variants.map((v) => matchScore(v, option.title)));
    if (base === 0) continue;
    scored.push({ option, score: base + SOURCE_BOOST[option.source] });
  }
  scored.sort((a, b) => b.score - a.score || a.option.title.length - b.option.title.length);

  const out: TopicOption[] = [];
  for (const { option } of scored) {
    const key = normalizeTopic(option.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(option);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * "Did you mean …?" — offered only when nothing matches cleanly and a typo
 * match exists, so it never second-guesses a topic that is simply not in the
 * lists.
 */
export function didYouMean(query: string, options: TopicOption[]): TopicOption | null {
  const variants = queryVariants(query);
  if (!variants[0] || variants[0].length < 4) return null;
  let best: { option: TopicOption; score: number } | null = null;
  for (const option of options) {
    const score = Math.max(...variants.map((v) => matchScore(v, option.title)));
    if (score >= 60) return null; // a clean match exists: the list already shows it
    if (score > 0 && (!best || score > best.score)) best = { option, score };
  }
  return best?.option ?? null;
}

/** The option a typed topic corresponds to exactly, if any — for its system label. */
export function exactOption(topic: string, options: TopicOption[]): TopicOption | null {
  const key = normalizeTopic(topic);
  return options.find((o) => normalizeTopic(o.title) === key) ?? null;
}
