import { t } from "../i18n";
import { currentHealth } from "./healthWindow";
import type { DecorationInput } from "./decorations";

const PILLS = ".chip-trouble";

/** Everything the chip view wrote under the Live root (it lives in this lazy chunk, not the Live session). */
export function clear(root: ParentNode) {
  for (const el of root.querySelectorAll(`[data-live-trouble], [data-live-rate], [data-live-cut], ${PILLS}`)) {
    for (const attr of ["data-live-trouble", "data-live-rate", "data-live-cut", "data-failing"])
      el.removeAttribute(attr);
    if (el.matches(PILLS)) el.textContent = "";
  }
}

/** Screen-only summaries load on Live intent, independently of the simulation runtime. */
export function rollup(pills: HTMLElement[], trouble: ReadonlyMap<string, number[]>) {
  for (const pill of pills) {
    const [failing, stressed] = trouble.get(pill.dataset.testid?.slice("zone-trouble-".length) ?? "") ?? [0, 0];
    const text =
      failing && stressed
        ? t("live.zoneTrouble", { failing, stressed })
        : failing
          ? t("live.zoneFailing", { failing })
          : stressed
            ? t("live.zoneStressed", { stressed })
            : "";
    if (pill.textContent !== text) pill.textContent = text;
    if (pill.hasAttribute("data-failing") !== !!failing) pill.toggleAttribute("data-failing", !!failing);
  }
}

export function rateLevel(rate: number) {
  return Math.min(5, Math.ceil(Math.log10(1 + rate)));
}

export function decorate(
  nodes: HTMLElement[],
  root: ParentNode,
  edges: HTMLElement[],
  boundaries: HTMLElement[],
  { snapshot, health, zones }: DecorationInput,
  rates: ReadonlyMap<string, number>,
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
  rollup([...root.querySelectorAll<HTMLElement>(PILLS)], trouble);
  const cut = new Set((snapshot.faults ?? []).flatMap((f) => (f.kind === "link" ? [f.edge] : [])));
  const rate = (id: string) => (rates.get(id) ?? 0) * (snapshot.scale ?? 1);
  for (const el of edges) {
    attr(el, "data-live-rate", String(rateLevel(rate(el.dataset.id!))));
    for (const section of el.querySelectorAll("[data-chip-members]")) {
      const members: string[] = JSON.parse(section.getAttribute("data-chip-members")!);
      attr(section, "data-live-rate", String(rateLevel(members.reduce((sum, id) => sum + rate(id), 0))));
    }
    attr(el, "data-live-cut", cut.has(el.dataset.id!) ? "1" : null);
  }
}
