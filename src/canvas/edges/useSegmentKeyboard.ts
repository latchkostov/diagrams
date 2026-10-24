import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { shortcutFor, isEditableTarget } from "../../editor/shortcuts";
import { t } from "../../i18n";
import { createMachine, defineMachine } from "../../lib/machine";
import type { EdgeRoute } from "../geometry/router";
import { useInteraction } from "../interaction/useInteraction";
import { useDiagram } from "../DiagramContext";
import { startSegment, nudgeSegment } from "./segmentKeyboard";
import type { RouteSegment } from "./segments";

export const routeAnnouncementMachine = defineMachine<
  { value: "automatic" | "shaped" },
  { type: "route"; custom: boolean },
  "reset"
>({
  initial: { value: "automatic" },
  states: ["automatic", "shaped"],
  events: [
    { type: "route", custom: true },
    { type: "route", custom: false },
  ],
  on: {
    automatic: { route: { target: "shaped", guard: (_, e) => e.custom } },
    shaped: { route: { target: "automatic", guard: (_, e) => !e.custom, effects: () => ["reset"] } },
  },
});

export function useSegmentKeyboard(
  id: string,
  route: EdgeRoute,
  segments: RouteSegment[],
  alone: boolean,
  stubs: () => [number, number],
  snap: () => boolean,
) {
  const interaction = useInteraction();
  const { reshape, announce } = useDiagram();
  const [announcements] = useState(() =>
    createMachine({
      ...routeAnnouncementMachine,
      initial: { value: route.custom ? ("shaped" as const) : ("automatic" as const) },
    }),
  );
  const selected = useSyncExternalStore(
    interaction?.subscribe ?? noSubscribe,
    () => interaction?.getSnapshot().keyboardSegment,
  );
  const initial = startSegment(segments, route.label);
  const index = selected?.edge === id ? Math.min(selected.k, segments.length - 1) : initial;
  useLayoutEffect(() => {
    const result = announcements.send({ type: "route", custom: !!route.custom });
    for (const command of result.commands) if (command === "reset") announce?.(t("edge.shape.reset"));
  }, [announcements, route.custom, announce]);
  useLayoutEffect(() => {
    if (!alone || !reshape || !interaction || !segments.length) return;
    const edge = document.querySelector(`[data-testid="edge-${CSS.escape(id)}"]`)?.parentElement;
    if (!edge) return;
    const describe = (at: number) => {
      const s = segments[at];
      announce?.(
        s.axis === "v"
          ? t("edge.shape.vertical", { index: at + 1, count: segments.length })
          : t("edge.shape.horizontal", { index: at + 1, count: segments.length }),
      );
    };
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return;
      const shortcut = shortcutFor(event);
      if (!["segment-prev", "segment-next", "nudge", "nudge-far"].includes(shortcut ?? "")) return;
      const cycling = shortcut === "segment-prev" || shortcut === "segment-next";
      const at = interaction.stepSegment(
        id,
        cycling ? (index + (shortcut === "segment-next" ? 1 : -1) + segments.length) % segments.length : index,
      );
      if (at < 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (cycling) {
        describe(at);
        return;
      }
      const s = segments[index];
      const horizontalKey = event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (horizontalKey !== (s.axis === "v")) {
        announce?.(s.axis === "v" ? t("edge.shape.useHorizontal") : t("edge.shape.useVertical"));
        return;
      }
      const sign = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      const next = nudgeSegment(route.points, s, sign, shortcut === "nudge-far", snap(), stubs());
      const waypoints = next.points.slice(1, -1);
      if (waypoints.length > 64) return;
      interaction.stepSegment(id, next.index);
      reshape(id, { waypoints: waypoints.length ? waypoints : undefined }, { merge: `waypoints:${id}` });
      announce?.(t("edge.shape.moved", { direction: event.key.slice(5).toLowerCase(), distance: next.distance }));
    };
    edge.addEventListener("keydown", key);
    return () => edge.removeEventListener("keydown", key);
  }, [alone, reshape, interaction, segments, id, announce, index, initial, route.points, snap, stubs]);
  return segments[index]?.k;
}
const noSubscribe = () => () => {};
