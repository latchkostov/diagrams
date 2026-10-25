import { t } from "../../i18n";
import { useStore } from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MessageTrace } from "../../sim/types";
import { type TraceChoice } from "../context";
import { downstreamOfEdge, edgesWithin } from "../graph";
import { useTraceRuntime } from "./useTraceRuntime";
import { suggestedMessageType } from "../storm";
import { roomUnderCard } from "../traceCardLayout";

import type { CameraController } from "../../canvas/camera";
import type { InteractionController } from "../../canvas/interaction";
import { useReducedMotion } from "../../lib/useReducedMotion";
import type { LiveSessionState } from "./useLiveSessionState";

const DEAD_LETTER_WAIT = "trace:deadLetterWait";

export function useTraceSpotlight({
  session,
  camera,
  interaction,
}: {
  session: LiveSessionState;
  camera: CameraController;
  interaction: InteractionController;
}) {
  const { state, controller, trace, panel } = session;
  // ---------------------------------------------------------------- spotlight (notes, trace)

  const note = state.run?.note;
  const noteKey = note ? `${state.generation}:${note.atMs}:${note.text}` : "";
  // The controller publishes fresh note objects each tick; keep the focus stable for camera effects.
  const focusKey = JSON.stringify(note?.focus ?? []);
  const noteFocus = useMemo(() => JSON.parse(focusKey) as string[], [focusKey]);
  // A traced message lights the path it has taken so far (or the node it's awaited at).
  const runtime = useTraceRuntime(session, interaction);
  const { slowRef } = runtime;
  const tracedNow = state.trace?.current;
  const awaitedAt = state.trace?.pending?.next === "message" ? state.trace.pending.node : undefined;
  const tracedDiagram = controller.currentDiagram;
  const { journey, journeyReady } = runtime;
  const tracedPath = useMemo(() => {
    if (tracedNow) return journeyReady ? journey(tracedNow, tracedDiagram) : { status: "loading" as const };
    return awaitedAt
      ? { status: "ready" as const, path: { nodes: new Set([awaitedAt]), edges: new Set<string>() } }
      : null;
  }, [tracedNow, awaitedAt, tracedDiagram, journey, journeyReady]);
  const slowPath = runtime.path;
  const spotlight = (() => {
    const d = controller.currentDiagram;
    if (slowPath) return { ...slowPath, kind: "trace" as const };
    if (tracedPath?.status === "loading") return null;
    if (tracedPath) return { ...tracedPath.path, kind: "trace" as const };
    if (trace) {
      const r = downstreamOfEdge(d.edges, trace);
      return { nodes: r.nodes, edges: r.edges, kind: "trace" as const };
    }
    if (noteFocus.length) {
      const focus = new Set(noteFocus);
      return { nodes: focus, edges: edgesWithin(d.edges, focus), kind: "focus" as const };
    }
    return null;
  })();
  const spotlightRef = useRef(spotlight);
  useLayoutEffect(() => {
    spotlightRef.current = spotlight;
  }, [spotlight]);

  // The camera (src/canvas/camera, panePolicy rows L1–L9): Live says what changed in its room, and the policy
  // decides once the pane settles. A note's focus takes the view, and the whole diagram comes back when the
  // story moves on. The side panel and the trace card cover the right of the pane: a fitted view refits into
  // what they leave (a narrated one to the note's focus), a view moved by hand stays put.
  const reducedMotion = useReducedMotion();
  useEffect(() => {
    camera.dispatch({ type: "narration", focus: noteFocus });
  }, [camera, noteKey, noteFocus]);
  useEffect(() => {
    if (panel.open && panel.kind === "sims") return; // SimPanelFrame owns its mount, including Loading.
    camera.dispatch({ type: "live.panel", open: panel.open });
  }, [camera, panel.open, panel.kind]);
  const cardOpen = !!state.trace;
  useEffect(() => {
    camera.dispatch({ type: "live.card", open: cardOpen });
  }, [camera, cardOpen]);

  return { slowRef, spotlightRef, reducedMotion, runtime };
}

export function useTraceActions({
  session,
  spotlight,
  presenting,
}: {
  session: LiveSessionState;
  spotlight: TraceSpotlight;
  presenting: boolean;
}) {
  const { controller, flash, state, panel, notice, getDiagram } = session;
  const { slowRef } = spotlight;
  const [sequence, setSequence] = useState<MessageTrace | null>(null);
  // One way in for the ⋯ menu, the right-click and the palette (same words when there's nothing yet).
  const startTrace = useCallback(
    (which: TraceChoice) => {
      if (which === "slowmo") return slowRef.current?.start({ kind: "next" });
      // A new trace leaves slow motion first (live comes back where it was).
      slowRef.current?.end();
      if (which === "next") controller.traceNext();
      else if (which === "slowest") {
        if (!controller.traceSlowest()) flash(t("liveSession.noFinishedMessage"));
      } else if (controller.traceDeadLettered() === "waiting") flash(DEAD_LETTER_WAIT);
    },
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, flash],
  );
  // The card grows down to the first node under it (its hops scroll), never over the diagram. Heading
  // a side panel's column, its height is the panel's business (trace.css).
  const cardRoom = useStore((s) => (state.trace && !panel.open ? roomUnderCard(s, presenting ? 392 : 352) : 0));
  // "Nothing has dead-lettered yet" is out of date once one has: the trace card takes over.
  const shownNotice =
    state.resourceError ??
    (notice === DEAD_LETTER_WAIT ? (state.trace?.current ? null : t("liveSession.deadLetterWait")) : notice) ??
    (!state.simulation && state.traffic && !Object.values(state.snapshot.nodes).some((node) => node.role === "source")
      ? t("liveSession.noTrafficSources")
      : null);
  const sendOne = useCallback(
    (nodeId: string) => controller.sendOne(nodeId, suggestedMessageType(getDiagram(), nodeId)),
    [controller, getDiagram],
  );

  return { sequence, setSequence, startTrace, cardRoom, shownNotice, sendOne };
}

export function useTraceState() {
  const [trace, setTrace] = useState<string | null>(null);
  const traceRef = useRef(trace);
  useLayoutEffect(() => {
    traceRef.current = trace;
  }, [trace]);
  return { trace, traceRef, setTrace };
}

export type TraceSpotlight = ReturnType<typeof useTraceSpotlight>;
export type TraceActions = ReturnType<typeof useTraceActions>;
export type TraceSlowMotion = { slow: import("../slowmo/controller").SlowMotionView; slowMotionTrace(): void };
