/**
 * Small fuzzy matcher for the command palette. Scores are on a 0–100 scale per token so sources
 * can be compared: an exact or prefix hit always beats a scattered subsequence.
 *
 *   100  the whole text equals the token
 *    90  the text starts with the token        "ren"  → "Rename node"
 *    75  a later word starts with the token    "node" → "Rename node"
 *    70  two adjacent words joined start with it   "fanout" → "fan-out"
 *    70  the word initials start with it       "tl"   → "Toggle live"
 *    50  substring anywhere                    "ayou" → "Auto-layout"
 * 10–40  subsequence (3+ letters; labels only), tighter and on word starts scores higher   "rnm" → "Rename"
 */

export const SCORE = { exact: 100, prefix: 90, wordPrefix: 75, acronym: 70, substring: 50 } as const;

const WORD = /[^\p{L}\p{N}#+]+/u;

export function words(text: string): string[] {
  return text.toLowerCase().split(WORD).filter(Boolean);
}

/** Splits a query into lower-cased tokens. */
export function tokens(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Score one (lower-cased) token against a text; 0 = no match. */
export function scoreToken(token: string, text: string): number {
  if (!token) return 0;
  const t = text.toLowerCase();
  if (t === token) return SCORE.exact;
  if (t.startsWith(token)) return SCORE.prefix;
  const ws = words(t);
  const at = ws.findIndex((w) => w.startsWith(token));
  // Later words rank a touch lower, so the hit nearest the front wins a tie.
  if (at > 0) return SCORE.wordPrefix - Math.min(at - 1, 4);
  if (at === 0) return SCORE.prefix;
  // Hyphenated and spaced compounds: "fanout" finds "fan-out", "drawio" finds "draw.io".
  if (ws.some((w, i) => i + 1 < ws.length && (w + ws[i + 1]).startsWith(token) && token.length > w.length))
    return SCORE.wordPrefix - 5;
  const initials = ws.map((w) => w[0]).join("");
  if (token.length >= 2 && initials.startsWith(token)) return SCORE.acronym;
  if (token.length >= 2 && t.includes(token)) return SCORE.substring;
  return subsequence(token, t);
}

/** 10–40 for an in-order subsequence; 0 otherwise. Rewards word starts and consecutive runs. */
export function subsequence(token: string, text: string): number {
  // Two scattered letters match almost anything: subsequences need three.
  if (token.length < 3) return 0;
  let ti = 0;
  let bonus = 0;
  let prev = -2;
  let first = -1;
  for (let i = 0; i < text.length && ti < token.length; i++) {
    if (text[i] !== token[ti]) continue;
    if (first < 0) first = i;
    if (i === 0 || WORD.test(text[i - 1])) bonus += 2;
    if (i === prev + 1) bonus += 1;
    prev = i;
    ti++;
  }
  if (ti < token.length) return 0;
  const span = prev - first + 1;
  const tightness = token.length / span; // 1 = consecutive
  return Math.round(10 + 18 * tightness + Math.min(12, bonus));
}

export interface Searchable {
  label: string;
  /** Extra words (aliases, breadcrumb, vendor). Matched at a discount. */
  keywords?: string;
}

/** Keywords are a weaker signal than the label people read. */
export const KEYWORD_WEIGHT = 0.8;

/**
 * Average per-token score for a query, 0 when any token misses. A label that starts with the
 * whole query (multi-word) gets a small bonus so "add bo" prefers "Add boundary".
 */
export function scoreQuery(query: string, item: Searchable): number {
  const ts = tokens(query);
  if (!ts.length) return 1;
  let total = 0;
  for (const t of ts) {
    const inLabel = scoreToken(t, item.label);
    // Keywords are long, mixed bags (ids, subtitles, breadcrumbs): only word-prefix hits count there,
    // not initials or scattered letters.
    const kw = item.keywords ? scoreToken(t, item.keywords) : 0;
    const inKeywords = kw > SCORE.wordPrefix - 5 ? kw * KEYWORD_WEIGHT : 0;
    const best = Math.max(inLabel, inKeywords);
    if (!best) return 0;
    total += best;
  }
  let score = total / ts.length;
  if (ts.length > 1 && item.label.toLowerCase().startsWith(query.toLowerCase().trim())) score += 8;
  return score;
}
