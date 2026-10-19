import type { Stencil } from "../../model/types";

// Offline files stay English. Reuse the catalog instead of carrying its translated copy too.
export const stencilLabel = (s: Stencil): string => s.label;
export const stencilDescription = (s: Stencil): string => s.description;
export const stencilSubtitle = (s: Stencil): string | undefined => s.defaultSublabel;
export const vendorLabel = (vendor: string): string => vendor;
