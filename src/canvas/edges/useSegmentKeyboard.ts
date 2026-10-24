import { useEffectEvent, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { shortcutFor, isEditableTarget } from "../../editor/shortcuts";
import { t } from "../../i18n";
import { createMachine, defineMachine } from "../../lib/machine";
import type { EdgeRoute } from "../geometry/router";
import { useInteraction } from "../interaction/useInteraction";
import { useDiagram } from "../DiagramContext";
import { startSegment, nudgeSegment, followSegment } from "./segmentKeyboard";
import { routeSegments, type RouteSegment } from "./segments";

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
  const index =
    selected?.edge === id
      ? selected.leg
        ? followSegment(segments, selected.leg)
        : Math.min(selected.k, segments.length - 1)
      : initial;
  useLayoutEffect(() => {
    if (selected?.edge === id && segments.length && selected.k !== index)
      interaction?.stepSegment(id, index, selected.leg);
  }, [selected, id, index, interaction, segments.length]);
  useLayoutEffect(() => {
    const result = announcements.send({ type: "route", custom: !!route.custom });
    for (const command of result.commands) if (command === "reset") announce?.(t("edge.shape.reset"));
  }, [announcements, route.custom, announce]);
  const key = useEffectEvent((event: KeyboardEvent) => {
    if (!alone || !reshape || !interaction || !segments.length) return;
    const describe = (at: number) => {
      const s = segments[at];
      announce?.(
        s.axis === "v"
          ? t("edge.shape.vertical", { index: at + 1, count: segments.length })
          : t("edge.shape.horizontal", { index: at + 1, count: segments.length }),
      );
    };
    if (event.defaultPrevented || event.isComposing || isEditableTarget(event.target)) return;
    const shortcut = shortcutFor(event);
    if (!["segment-prev", "segment-next", "nudge", "nudge-far"].includes(shortcut ?? "")) return;
    const cycling = shortcut === "segment-prev" || shortcut === "segment-next";
    const nextIndex = cycling
      ? (index + (shortcut === "segment-next" ? 1 : -1) + segments.length) % segments.length
      : index;
    const at = interaction.stepSegment(id, nextIndex, segments[nextIndex]);
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
    interaction.stepSegment(id, next.index, routeSegments(next.points)[next.index]);
    reshape(id, { waypoints: waypoints.length ? waypoints : undefined }, { merge: `waypoints:${id}` });
    announce?.(t("edge.shape.moved", { direction: event.key.slice(5).toLowerCase(), distance: next.distance }));
  });
  const enabled = alone && !!reshape && !!interaction && segments.length > 0;
  useLayoutEffect(() => {
    if (!enabled) return;
    const edge = document.querySelector(`[data-testid="edge-${CSS.escape(id)}"]`)?.parentElement;
    if (!edge) return;
    const listener = (event: KeyboardEvent) => key(event);
    edge.addEventListener("keydown", listener);
    return () => edge.removeEventListener("keydown", listener);
  }, [enabled, id]);
  return segments[index]?.k;
}
const noSubscribe = () => () => {};
