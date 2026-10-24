// Route presentation and authoring load with routing controls and playback, not file validation.
import {
  ROUTE_MARKERS,
  type RequestRoute,
  type RequestAddress,
  type RouteMatch,
  type RouteMarker,
  type TrafficMix,
} from "./requestRouting";
import { SIM_LIMITS } from "./simLimits";

// ---------------------------------------------------------------- appearance

/** Okabe–Ito colour-universal palette: distinct under common colour-vision deficiencies. */
export const ROUTE_PALETTE = ["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7"] as const;
/** Every colour once per marker before any pair repeats: 28 distinct pairs. */
export const ROUTE_PAIRS = ROUTE_PALETTE.length * ROUTE_MARKERS.length;

export interface RouteLook {
  color: string;
  marker: RouteMarker;
}
const pair = (index: number): { paletteSlot: number; marker: RouteMarker } => ({
  paletteSlot: index % ROUTE_PALETTE.length,
  marker: ROUTE_MARKERS[Math.floor(index / ROUTE_PALETTE.length) % ROUTE_MARKERS.length],
});
function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}
/** A route's saved colour and marker, or a deterministic one from its id when none was saved. */
export function routeLook(route: Pick<RequestRoute, "id" | "appearance">): RouteLook {
  const a = route.appearance ?? pair(hash(route.id) % ROUTE_PAIRS);
  return { color: ROUTE_PALETTE[a.paletteSlot] ?? ROUTE_PALETTE[0], marker: a.marker };
}
/** The first colour/marker pair no route uses yet, in stable order (after all 28, they repeat in order). */
export function nextAppearance(routes: readonly RequestRoute[]): { paletteSlot: number; marker: RouteMarker } {
  const used = new Set(
    routes.map((r) => {
      const a = r.appearance ?? pair(hash(r.id) % ROUTE_PAIRS);
      return a.paletteSlot + ROUTE_PALETTE.length * ROUTE_MARKERS.indexOf(a.marker);
    }),
  );
  for (let i = 0; i < ROUTE_PAIRS; i++) if (!used.has(i)) return pair(i);
  return pair(routes.length % ROUTE_PAIRS);
}

/** "POST /orders" (method and path); a label, when given, names it in lists. */
export const addressText = (address: Pick<RequestAddress, "method" | "path">) => `${address.method} ${address.path}`;
export const routeName = (route: RequestRoute) => route.label?.trim() || addressText(route.address);

/** The compact text of a match: "POST /orders", "GET /api/*", "Any /search". */
export function matchText(match: RouteMatch): string {
  const methods = match.methods?.join("|") ?? "*";
  const path = !match.path ? "*" : match.path.kind === "prefix" ? `${match.path.value}*` : match.path.value;
  const host = match.hosts?.length ? ` @${match.hosts.join("|")}` : "";
  const extra = Object.keys(match.headers ?? {}).length + Object.keys(match.query ?? {}).length;
  return `${methods} ${path}${host}${extra ? ` +${extra}` : ""}`;
}

/** A rates-mode mix with every row × factor (the Inputs panel's entry rate, Traffic ×): one scaling, all rows. */
export function scaleMix(mix: TrafficMix, factor: number): TrafficMix {
  if (mix.mode !== "rates") return mix;
  const f = Number.isFinite(factor) ? Math.max(0, factor) : 1;
  return {
    mode: "rates",
    entries: mix.entries.map((e) => ({ ...e, ratePerSec: Math.min(SIM_LIMITS.ratePerSec, e.ratePerSec * f) })),
  };
}
