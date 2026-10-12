import { catalog } from "../stencils/catalog";
import { searchStencils } from "../lib/stencilSearch";
import { inferStencil } from "../interop/infer";
import type { StencilCategory } from "../model/types";
import type { StencilResolution } from "./index";

export function findStencils(query: string, options: { category?: StencilCategory; limit?: number } = {}) {
  return searchStencils(
    catalog.filter((s) => !options.category || s.category === options.category),
    query,
  )
    .slice(0, Math.max(1, Math.min(10, options.limit ?? 5)))
    .map(({ id, label, vendor, category, simRole, description }) => ({
      id,
      label,
      vendor,
      category,
      simRole,
      description,
    }));
}
/**
 * Plain words agents (and small models) use for a kind, where the catalogue search picks the wrong
 * stencil: "API" isn't GraphQL, "Redis" alone is the cache, "PubSub" is Google's, and a "processor" or
 * "component" is a generic service. Checked after an exact id, before search.
 */
const KIND_WORDS: Record<string, string> = {
  api: "generic.service",
  backend: "generic.service",
  "backend service": "generic.service",
  service: "generic.service",
  microservice: "generic.service",
  processor: "generic.service",
  component: "generic.service",
  "unspecified component": "generic.service",
  "generic component": "generic.service",
  application: "generic.service",
  app: "generic.service",
  server: "generic.service",
  consumer: "generic.service",
  worker: "generic.service",
  pubsub: "gcp.pubsub",
  "pub sub": "gcp.pubsub",
  redis: "redis.cache",
};

/** The words without a leading article ("a processor", "an API", "the database"). */
const bare = (kind: string) => kind.trim().replace(/^(?:a|an|the)\s+/i, "");

export function resolveKind(kind: string, label?: string): StencilResolution {
  kind = bare(kind);
  const word = catalog.find((s) => s.id === KIND_WORDS[kind.toLowerCase().replace(/\s+/g, " ")]);
  if (word && !catalog.some((s) => s.id === kind))
    return {
      id: word.id,
      label: word.label,
      confidence: "high",
      alternatives: searchStencils(catalog, kind)
        .filter((s) => s.id !== word.id)
        .slice(0, 3)
        .map((s) => s.id),
    };
  const exact = catalog.find((s) => s.id === kind);
  const matches = kind.trim() ? searchStencils(catalog, kind) : [];
  const inferred = kind.trim() ? inferStencil(kind, label) : undefined;
  const normalized = kind.toLowerCase().trim().replace(/\s+/g, " ");
  const named = matches.find((s) => s.label.toLowerCase() === normalized || s.id.toLowerCase() === normalized);
  const selected =
    exact ??
    named ??
    matches[0] ??
    catalog.find((s) => s.id === inferred) ??
    catalog.find((s) => s.id === "generic.service")!;
  const confidence = exact || named || matches.length === 1 ? "high" : matches.length || inferred ? "medium" : "low";
  const alternatives = [
    ...new Map(
      [
        ...matches,
        ...(confidence === "high"
          ? []
          : kind
              .trim()
              .split(/\s+/)
              .flatMap((word) => searchStencils(catalog, word))),
        ...(confidence === "high"
          ? []
          : searchStencils(
              catalog.filter((s) => s.category === selected.category),
              selected.simRole,
            )),
      ]
        .filter((s) => s.id !== selected.id)
        .map((s) => [s.id, s]),
    ).values(),
  ]
    .slice(0, 3)
    .map((s) => s.id);
  return {
    id: selected.id,
    label: selected.label,
    confidence,
    alternatives,
  };
}

/** Is this phrase one of the plain role words ("API", "processor", "worker") that mean a generic service? */
export const isRoleWord = (phrase: string) => {
  const p = bare(phrase).toLowerCase().replace(/\s+/g, " ");
  // Plurals too: "workers", "consumers".
  return KIND_WORDS[p] === "generic.service" || (p.endsWith("s") && KIND_WORDS[p.slice(0, -1)] === "generic.service");
};

const VENDORS = new Set(["azure", "aws", "amazon", "google", "gcp", "microsoft", "cloud"]);
const wordsOf = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9#+]+/)
    .filter((w) => w.length > 1);
const stem = (w: string) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

/**
 * The stencil a phrase plausibly names, or undefined: stricter than resolveKind, which always answers
 * (even "billing" finds Stripe, through an alias). The phrase must share a word with the stencil's
 * label or id ("Mobile Client" names the Mobile App), or be a plain role word or end in one ("a
 * processor", "shipping consumers": a generic service). A vendor alone ("Azure") names nothing.
 */
export function namedStencil(phrase: string): string | undefined {
  const words = wordsOf(bare(phrase)).map(stem);
  if (!words.length || words.every((w) => VENDORS.has(w))) return undefined;
  if (isRoleWord(phrase)) return "generic.service";
  const r = resolveKind(phrase);
  if (r.confidence !== "low") {
    const s = catalog.find((x) => x.id === r.id)!;
    const known = new Set([s.label, s.id.replace(/[.-]/g, " ")].flatMap(wordsOf).map(stem));
    if (words.some((w) => !VENDORS.has(w) && known.has(w))) return r.id;
  }
  // "shipping consumers", "billing worker": named by its role, no technology.
  return isRoleWord(words[words.length - 1]) ? "generic.service" : undefined;
}

/** namedStencil, only when the catalogue search is confident too (implicit additions use this). */
export function confidentStencil(phrase: string): string | undefined {
  const named = namedStencil(phrase);
  return named && (isRoleWord(phrase) || resolveKind(phrase).confidence === "high") ? named : undefined;
}
