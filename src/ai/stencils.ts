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
export function resolveKind(kind: string, label?: string): StencilResolution {
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
