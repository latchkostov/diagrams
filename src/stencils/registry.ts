import type { Stencil } from "../model/types";
import { catalog } from "./catalog";

const iconUrls = import.meta.glob("./icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const byId = new Map(catalog.map((s) => [s.id, s]));

export const stencils: readonly Stencil[] = catalog;

export const FALLBACK_STENCIL: Stencil = {
  id: "generic.unknown",
  label: "Unknown",
  category: "generic",
  vendor: "Generic",
  icon: "generic-box",
  accent: "#64748b",
  simRole: "processor",
  description: "Stencil not found in this version of the catalog.",
};

export function getStencil(id: string): Stencil {
  return byId.get(id) ?? FALLBACK_STENCIL;
}

export function iconUrl(icon: string): string | undefined {
  return iconUrls[`./icons/${icon}.svg`];
}
