import type { DiagramFile } from "../model/types";
import { profileOf } from "../stencils/profiles";
import { getLocale, t } from "../i18n";
import type { LiveState } from "./controller";
import { currentHealth } from "./healthWindow";
import { formatCount, formatRate } from "./format";
import { latencyLabel } from "./latencyFormat";

const families = new WeakMap<DiagramFile, Map<string, string>>();
const hidden = new WeakMap<HTMLElement, Map<Element, string | null>>();
const written = new WeakMap<
  HTMLElement,
  { state: LiveState; readout: HTMLElement; locale: string; fault?: string | null; capacity?: string | null }
>();

/** Virtual-cursor reading does not focus or pan. Refresh semantics even while visual ink waits.
 * This runs once per publication, without React renders or geometry/style reads. */
export function refresh(
  root: HTMLElement | null,
  state: LiveState,
  visible: ReadonlySet<string> | null,
  diagram: DiagramFile,
) {
  let kinds = families.get(diagram);
  if (!kinds) {
    kinds = new Map(
      diagram.nodes.map((n) => [n.id, profileOf(n.stencil)?.family === "serverless" ? "execution" : "thread"]),
    );
    families.set(diagram, kinds);
  }
  for (const badge of root?.querySelectorAll<HTMLElement>('[data-testid^="node-badge-"]') ?? []) {
    const id = badge.dataset.testid!.slice("node-badge-".length);
    const s = state.snapshot.nodes[id];
    let readout = badge.querySelector<HTMLElement>("[data-badge-semantics-text]");
    if (
      !s ||
      !visible ||
      visible.has(id) ||
      ["queue", "topic", "stream"].includes(s.role) ||
      badge.classList.contains("is-hovered")
    ) {
      for (const [element, original] of hidden.get(badge) ?? []) {
        if (original === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", original);
      }
      hidden.delete(badge);
      written.delete(badge);
      readout?.remove();
      continue;
    }
    if (!readout) {
      readout = document.createElement("span");
      readout.className = "sr-only";
      readout.setAttribute("role", "group");
      readout.dataset.badgeSemanticsText = "";
      const meter = document.createElement("span");
      meter.dataset.testid = `thread-readout-${id}`;
      readout.append(meter);
      badge.append(readout);
    }
    let originals = hidden.get(badge);
    if (!originals) hidden.set(badge, (originals = new Map()));
    for (const child of originals.keys()) if (child.parentElement !== badge) originals.delete(child);
    for (const child of badge.children) {
      if (child === readout || originals.has(child)) continue;
      originals.set(child, child.getAttribute("aria-hidden"));
      if (child.getAttribute("aria-hidden") !== "true") child.setAttribute("aria-hidden", "true");
    }
    const fault = badge.querySelector('[data-testid^="node-fault-"]')?.textContent;
    const capacity = badge.querySelector('[data-testid^="capacity-label-"]')?.getAttribute("aria-label");
    const locale = getLocale();
    const previous = written.get(badge);
    // Store/DOM notifications can follow the same publication. Pan frames also reuse it.
    if (
      previous?.state === state &&
      previous.readout === readout &&
      previous.locale === locale &&
      previous.fault === fault &&
      previous.capacity === capacity
    )
      continue;
    written.set(badge, { state, readout, locale, fault, capacity });
    const noun = t("threads.noun", { kind: kinds.get(id) ?? "thread" });
    const health = currentHealth(s);
    const text = [
      s.status === "down" ? t("hover.downVerdict") : s.status === "paused" ? t("hover.pausedVerdict") : "",
      `${t("hover.processed")}: ${formatCount(s.processed)}`,
      `${t("hover.throughput")}: ${formatRate(s.throughput)}`,
      health.dropped ? t("threads.lostCount", { count: health.dropped }) : "",
      s.blocked ? `${t("hover.blocked")}: ${formatCount(s.blocked)}` : "",
      health.rejected > health.shed ? t("hover.rejectedVerdict", { count: health.rejected - health.shed }) : "",
      s.shed ? t("resilience.shedCount", { count: s.shed }) : "",
      s.queueLimit !== undefined ? t("resilience.queueOf", { count: s.queueDepth ?? 0, limit: s.queueLimit }) : "",
      s.latency ? latencyLabel(s.latency) : "",
      s.failingOver ? t("hover.failoverVerdict") : "",
      s.fleet ? t("hover.readyDesired", s.fleet) : "",
      s.fleet?.starting ? t("autoscaling.startingBadge", s.fleet) : "",
      s.fleet?.draining ? t("autoscaling.drainingBadge", s.fleet) : "",
      s.fleet?.decision?.reason === "max" ? t("autoscaling.maxReached") : "",
      s.idleReplicas
        ? t("broker.assigned", { active: (s.replicas ?? 0) - s.idleReplicas, configured: s.replicas ?? 0 })
        : "",
      fault,
      capacity,
    ]
      .filter(Boolean)
      .join(". ");
    if (readout.getAttribute("aria-label") !== text) readout.setAttribute("aria-label", text);
    const meter = readout.firstElementChild!;
    const threads = s.threads;
    const busy = threads ? threads.working + threads.waiting : 0;
    const known = threads && Number.isFinite(threads.slots);
    const attributes = {
      role: known ? "meter" : undefined,
      "aria-label": known ? t("threads.busy", { busy, slots: threads.slots, noun }) : undefined,
      "aria-valuemin": known ? 0 : undefined,
      "aria-valuemax": known ? Math.max(1, threads.slots) : undefined,
      "aria-valuenow": known ? Math.min(busy, threads.slots) : undefined,
      "aria-valuetext": known && threads.inFlight ? t("threads.inFlight", { count: threads.inFlight }) : undefined,
    };
    for (const [key, value] of Object.entries(attributes)) {
      if (value === undefined) {
        if (meter.hasAttribute(key)) meter.removeAttribute(key);
      } else if (meter.getAttribute(key) !== String(value)) meter.setAttribute(key, String(value));
    }
    const unknown = threads && !known ? t("threads.unknownPool", { busy, noun }) : "";
    if (meter.textContent !== unknown) meter.textContent = unknown;
  }
}
