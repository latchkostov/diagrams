/** Matching tiers shared by English agent discovery and localized UI discovery. */
export interface SearchText {
  id?: string;
  label: string;
  labelWords: readonly string[];
  words: readonly string[];
  hay: string;
  aliases?: readonly string[];
}

export const searchWords = (text: string): string[] => text.split(/[^\p{L}\p{N}#+]+/u).filter(Boolean);

export function tokenize(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Short tokens ("sb", "pg") must start a word. Zero means no match. */
export function scoreToken(ix: SearchText, token: string): number {
  if (ix.label === token || ix.id === token) return 100;
  if (ix.labelWords.includes(token)) return 85;
  if (ix.aliases?.includes(token)) return 80;
  if (ix.label.startsWith(token)) return 70;
  if (ix.words.includes(token)) return 60;
  if (ix.words.some((word) => word.startsWith(token))) return 40;
  if (token.length >= 3 && ix.hay.includes(token)) return 20;
  return 0;
}

/** Every token must match; an empty query matches everything. */
export function scoreTokens(tokens: readonly string[], score: (token: string) => number): number {
  if (!tokens.length) return 1;
  let total = 0;
  for (const token of tokens) {
    const value = score(token);
    if (!value) return 0;
    total += value;
  }
  return total;
}

/** Matching items, best first; ties retain input order. */
export function rankMatches<T>(list: readonly T[], score: (item: T) => number): T[] {
  return list
    .map((item, index) => ({ item, index, score: score(item) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
