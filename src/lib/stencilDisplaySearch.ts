import type { Stencil } from "../model/types";
import { getLocale } from "../i18n/core";
import { categoryLabel, familyLabel } from "../i18n/chrome";
import { galleryRoleMeta } from "../i18n/galleryRoles";
import { stencilLabel, stencilDescription, stencilSubtitle, vendorLabel } from "../i18n/stencils";
import { familyOf } from "./vendorFamilies";
import { scoreStencil as englishScore } from "./stencilSearch";
import { rankMatches, scoreToken, scoreTokens, searchWords, tokenize, type SearchText } from "./stencilSearchCore";

// UI discovery extends the stable English agent search. Keep this module out of model/schema imports.
type Indexed = SearchText;
let index = new WeakMap<Stencil, Indexed>();
let indexLocale: string | undefined;

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
  hit = { label, labelWords: searchWords(label), words: searchWords(hay), hay };
  index.set(s, hit);
  return hit;
}

/** Every token can match either English aliases/metadata or the current language's display text. */
export function scoreStencil(s: Stencil, query: string): number {
  return scoreTokens(tokenize(query), (token) => Math.max(englishScore(s, token), scoreToken(indexed(s), token)));
}

export function searchStencils(list: readonly Stencil[], query: string): Stencil[] {
  return rankMatches(list, (s) => scoreStencil(s, query));
}
