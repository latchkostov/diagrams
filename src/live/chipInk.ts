import { t } from "../i18n";
import type { SimSnapshot } from "../sim/types";
import { currentHealth } from "./healthWindow";

export function clear(el: Element) {
  for (const attr of ["data-live-trouble", "data-live-rate", "data-failing"]) el.removeAttribute(attr);
  if (el.classList.contains("chip-trouble")) el.textContent = "";
}

/** Screen-only summaries load on Live intent, independently of the simulation runtime. */
export function rollup(pills: HTMLElement[], trouble: ReadonlyMap<string, number[]>) {
  for (const pill of pills) {
    const [failing, stressed] = trouble.get(pill.dataset.testid?.slice("zone-trouble-".length) ?? "") ?? [0, 0];
    const text = failing || stressed ? t("live.zoneTrouble", { failing, stressed }) : "";
    if (pill.textContent !== text) pill.textContent = text;
    if (pill.hasAttribute("data-failing") !== !!failing) pill.toggleAttribute("data-failing", !!failing);
  }
}

export function rateLevel(el: HTMLElement, id: string, rates: ReadonlyMap<string, number>) {
  const shared = el.firstElementChild?.getAttribute("data-chip-lanes");
  const rate = shared
    ? (JSON.parse(shared) as string[]).reduce((sum, edge) => sum + (rates.get(edge) ?? 0), 0)
    : (rates.get(id) ?? 0);
  return Math.min(5, Math.ceil(Math.log10(1 + rate)));
}

export function decorate(
  nodes: HTMLElement[],
  pills: HTMLElement[],
  edges: HTMLElement[],
  boundaries: HTMLElement[],
  snapshot: SimSnapshot,
  health: Pick<SimSnapshot, "nodes">,
  rates: ReadonlyMap<string, number>,
  zones?: ReadonlyMap<string, readonly string[]>,
) {
  const trouble = new Map<string, number[]>();
  const attr = (el: Element, key: string, value: string | null) => {
    if (el.getAttribute(key) === value) return;
    if (value === null) el.removeAttribute(key);
    else el.setAttribute(key, value);
  };
  const down = new Set((snapshot.faults ?? []).flatMap((f) => (f.kind === "boundary" ? [f.boundary] : [])));
  for (const el of boundaries) attr(el, "data-live-status", down.has(el.dataset.captionRoot!) ? "down" : null);
  for (const el of nodes) {
    const id = el.dataset.id!,
      n = snapshot.nodes[id];
    if (!n) continue;
    const recent = currentHealth(health.nodes[id]);
    const state =
      n.status === "down" || recent.failed + recent.dropped + recent.rejected + recent.shed > 0
        ? "failing"
        : n.status === "paused" || ((!n.noConsumer || n.role === "queue") && recent.growing)
          ? "stressed"
          : null;
    attr(el, "data-live-trouble", state);
    if (state)
      for (const zone of zones?.get(id) ?? []) {
        const counts = trouble.get(zone) ?? [0, 0];
        counts[state === "failing" ? 0 : 1]++;
        trouble.set(zone, counts);
      }
  }
  rollup(pills, trouble);
  const cut = new Set((snapshot.faults ?? []).flatMap((f) => (f.kind === "link" ? [f.edge] : [])));
  for (const el of edges) {
    attr(el, "data-live-rate", String(rateLevel(el, el.dataset.id!, rates)));
    attr(el, "data-live-cut", cut.has(el.dataset.id!) ? "1" : null);
  }
}
