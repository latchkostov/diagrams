import type { Stencil } from "../model/types";
import { getLocale } from "../i18n/core";
import { categoryLabel, familyLabel } from "../i18n/chrome";
import { galleryRoleMeta } from "../i18n/galleryRoles";
import { stencilLabel, stencilDescription, stencilSubtitle, vendorLabel } from "../i18n/stencils";
import { familyOf } from "./vendorFamilies";
import { scoreStencil as englishScore, tokenize } from "./stencilSearch";

// UI discovery extends the stable English agent search. Keep this module out of model/schema imports.
interface Indexed {
  label: string;
  labelWords: string[];
  words: string[];
  hay: string;
}
let index = new WeakMap<Stencil, Indexed>();
let indexLocale: string | undefined;
const words = (text: string) => text.split(/[^\p{L}\p{N}#+]+/u).filter(Boolean);

function indexed(s: Stencil): Indexed {
  const locale = getLocale();
  if (indexLocale !== locale) {
    index = new WeakMap();
    indexLocale = locale;
  }
  let hit = index.get(s);
  if (hit) return hit;
  const label = stencilLabel(s).toLowerCase();
  const hay = [
    label,
    vendorLabel(s.vendor),
    stencilSubtitle(s) ?? "",
    galleryRoleMeta[s.simRole].label,
    // Ordinary sources are clients, not third-party APIs.
    s.category === "clients" && s.simRole === "source" ? "" : categoryLabel[s.category],
    familyLabel[familyOf(s)],
    // English discovery retains its original result set; descriptions extend translated discovery only.
    locale === "en" ? "" : stencilDescription(s),
  ]
    .join(" ")
    .toLowerCase();
  hit = { label, labelWords: words(label), words: words(hay), hay };
  index.set(s, hit);
  return hit;
}

function displayScore(ix: Indexed, token: string): number {
  if (ix.label === token) return 100;
  if (ix.labelWords.includes(token)) return 85;
  if (ix.label.startsWith(token)) return 70;
  if (ix.words.includes(token)) return 60;
  if (ix.words.some((word) => word.startsWith(token))) return 40;
  if (token.length >= 3 && ix.hay.includes(token)) return 20;
  return 0;
}

/** Every token can match either English aliases/metadata or the current language's display text. */
export function scoreStencil(s: Stencil, query: string): number {
  const tokens = tokenize(query);
  if (!tokens.length) return 1;
  const ix = indexed(s);
  let total = 0;
  for (const token of tokens) {
    const score = Math.max(englishScore(s, token), displayScore(ix, token));
    if (!score) return 0;
    total += score;
  }
  return total;
}

export function searchStencils(list: readonly Stencil[], query: string): Stencil[] {
  return list
    .map((s, i) => ({ s, i, score: scoreStencil(s, query) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((r) => r.s);
}
