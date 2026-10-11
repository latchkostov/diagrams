import type { SimRole } from "../model/types";
import { catalog } from "./catalog";

// No UI registry or Vite assets: safe to import in a headless TypeScript process.
const roles = new Map(catalog.map((stencil) => [stencil.id, stencil.simRole]));
export function stencilRole(id: string): SimRole {
  return roles.get(id) ?? "processor";
}
