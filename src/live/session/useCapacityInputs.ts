import { useStoreApi } from "@xyflow/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { placeNextTo } from "../../canvas/placement";
import type { DiagramFlowEdge, FlowNode } from "../../canvas/types";
import { useLocale } from "../../i18n";
import type { Simulation } from "../../model/types";
import type { NodeStatus } from "../../sim/types";
import { stencilRole } from "../../stencils/roles";
import { capacityView, freePlaySimulation, inputsWithoutFix, withFix, type CapacityFix } from "../capacityModel";
import { capacityOverlay, useCapacityOverlay } from "../capacityOverlay";
import { LiveController } from "../controller";
import { type SlowMotionView } from "../slowmo/useSlowMotion";

import type { Dispatch, RefObject, SetStateAction } from "react";
import type { CameraController } from "../../canvas/camera";
import type { SessionProps } from "../LiveSession";
import type { LiveState } from "../controller";
import type { LivePanel } from "./useLiveCommands";
/** "Traffic into X": the first of these that starts traffic in the simulation (a source). */
const ENTRY_STENCILS = ["client.user", "client.browser", "generic.webhook"];

export function useCapacityError() {
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const clearCapacityError = useCallback(() => setCapacityError(null), []);

  return { capacityError, setCapacityError, clearCapacityError };
}

export function useCapacityInputs({
  params,
  controller,
  state,
  locale,
  capacityOpen,
  setPanel,
  slowRef,
  simsRef,
  draftRef,
  setDraft,
  editor,
  flash,
}: Pick<SessionProps, "params" | "editor"> & {
  controller: LiveController;
  state: LiveState;
  locale: ReturnType<typeof useLocale>;
  capacityOpen: boolean;
  setPanel: Dispatch<SetStateAction<LivePanel>>;
  slowRef: RefObject<SlowMotionView | null>;
  simsRef: RefObject<Simulation[]>;
  draftRef: RefObject<Simulation | null>;
  setDraft: Dispatch<SetStateAction<Simulation | null>>;
  flash: (text: string) => void;
}) {
  // ---------------------------------------------------------------- inputs & capacity

  const [forcedOverlay] = useState(params.capacity);
  const overlayPref = useCapacityOverlay();
  const showCapacity = forcedOverlay ?? overlayPref;
  const planDiagram = controller.currentDiagram;
  const freePlan = useMemo(() => freePlaySimulation(planDiagram, state.inputs), [planDiagram, state.inputs]);
  const plan = state.running ?? freePlan;
  // The run's outages (timeline chaos, Kill, Pause) as a stable key: the callout says "down", not "Healthy".
  const outageKey = JSON.stringify(
    Object.entries(state.snapshot.nodes)
      .filter(([, n]) => n.status !== "up")
      .map(([id, n]) => [id, n.status])
      .sort(),
  );
  const runStatus = useMemo(() => {
    const status: Record<string, NodeStatus> = Object.fromEntries(planDiagram.nodes.map((n) => [n.id, "up"]));
    for (const [id, st] of JSON.parse(outageKey) as [string, NodeStatus][]) status[id] = st;
    return status;
  }, [outageKey, planDiagram]);
  const fleetKey = JSON.stringify(
    Object.entries(state.snapshot.nodes).flatMap(([id, n]) => (n.fleet ? [[id, n.fleet.ready]] : [])),
  );
  const readyReplicas = useMemo(() => Object.fromEntries(JSON.parse(fleetKey) as [string, number][]), [fleetKey]);
  // Recomputed only when the plan or an outage changes (sliders, saves, edits, chaos), never per frame.
  const { value: capacity } = useMemo(
    () => ({
      locale,
      value: showCapacity || capacityOpen ? capacityView(planDiagram, plan, runStatus, readyReplicas) : null,
    }),
    [showCapacity, capacityOpen, planDiagram, plan, runStatus, readyReplicas, locale],
  );

  // The panel shows the heat map for this session only; leaving live view restores the preference.
  useEffect(() => () => capacityOverlay.endSession(), []);
  const openCapacity = useCallback((open = true) => {
    if (open) capacityOverlay.showForSession();
    setPanel((p) => (open ? { open: true, kind: "capacity", sim: null } : { ...p, open: false }));
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const closeCapacity = useCallback(() => openCapacity(false), [openCapacity]);

  /** Apply a bottleneck fix as one undoable edit: to the saved simulation, or the diagram in free play. */
  const applyFix = useCallback(
    (fix: CapacityFix) => {
      if (slowRef.current?.session.active) return;
      const st = controller.getState();
      const base = st.simulation;
      const inputs = inputsWithoutFix(st.inputs, fix);
      const saved = base && simsRef.current.find((x) => x.id === base.id);
      if (editor && base && saved && draftRef.current?.id !== base.id) {
        const next = withFix(saved, fix);
        editor.updateMeta({
          simulations: (editor.getDiagram().simulations ?? []).map((x) => (x.id === next.id ? next : x)),
        });
        controller.setInputs(inputs);
        controller.setBase(next);
      } else if (base) {
        // An unsaved draft (or the Lab): the fix joins it, to be saved with it.
        const next = withFix(base, fix);
        if (draftRef.current?.id === base.id) {
          setDraft(next);
          draftRef.current = next;
        }
        controller.setInputs(inputs);
        controller.setBase(next);
      } else if (editor) {
        const merge = "capacity:fix:" + Date.now();
        for (const c of fix.changes) editor.setNodeProps(c.nodeId, { [c.key]: c.to }, { merge });
        const d = controller.currentDiagram;
        controller.setInputs(inputs);
        controller.updateDiagram({
          ...d,
          nodes: d.nodes.map((n) => {
            const own = fix.changes.filter((c) => c.nodeId === n.id);
            return own.length
              ? { ...n, props: { ...n.props, ...Object.fromEntries(own.map((c) => [c.key, c.to])) } }
              : n;
          }),
        });
      } else {
        const props = structuredClone(inputs.props);
        for (const c of fix.changes) props[c.nodeId] = { ...props[c.nodeId], [c.key]: c.to };
        controller.setInputs({ ...inputs, props });
      }
      if (editor) flash("Applied the fix: " + fix.label + " (undo with Ctrl+Z).");
    },
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [controller, editor, flash],
  );

  return { showCapacity, planDiagram, capacity, openCapacity, closeCapacity, applyFix };
}

export function useCapacityEntry({
  editor,
  store,
  flash,
  camera,
}: Pick<SessionProps, "editor"> & {
  store: ReturnType<typeof useStoreApi<FlowNode, DiagramFlowEdge>>;
  flash: (text: string) => void;
  camera: CameraController;
}) {
  /**
   * "Traffic into X" when nothing sends traffic yet: an upstream source one gap before the node,
   * connected to it (one undoable edit), then the cursor in its rate field.
   */
  const addEntry = useCallback(
    (targetId: string) => {
      if (!editor) return;
      const target = editor.getNode(targetId);
      if (!target) return;
      // The palette's collision-aware placement, upstream: never on top of a node already there.
      const boxes = [...store.getState().nodeLookup.values()]
        .filter((n) => n.type === "diagram" && !n.hidden)
        .map((n) => ({
          id: n.id,
          x: n.internals.positionAbsolute.x,
          y: n.internals.positionAbsolute.y,
          width: n.measured.width ?? 220,
          height: n.measured.height ?? 72,
        }));
      const from = boxes.find((b) => b.id === targetId) ?? { x: target.x, y: target.y, width: 220, height: 72 };
      const direction = editor.getDiagram().direction === "TB" ? "TB" : "LR";
      const at = placeNextTo(from, { width: from.width, height: from.height }, boxes, direction, "upstream");
      // Same tick: the history debounce records the node, its label and its edge as one undo step.
      const stencil = ENTRY_STENCILS.find((x) => stencilRole(x) === "source") ?? ENTRY_STENCILS[0];
      const id = editor.addNode(stencil, at);
      editor.updateNode(id, { label: "Incoming traffic", sublabel: undefined });
      editor.connect(id, targetId);
      flash(`Added an entry point into ${target.label || target.id}. Set its rate in msg/s.`);
      // Bring the new node into view beside the panel, once it's measured.
      camera.dispatch({ type: "live.added", panel: true });
      // The panel lists it once the session picks up the edit; then the rate field takes the cursor.
      const started = performance.now();
      const focusRate = () => {
        const field = document.querySelector<HTMLInputElement>(`[data-testid="capacity-rate-${CSS.escape(id)}"]`);
        if (field) {
          field.focus();
          field.select();
        } else if (performance.now() - started < 2000) requestAnimationFrame(focusRate);
      };
      requestAnimationFrame(focusRate);
    },
    [editor, store, flash, camera],
  );

  return addEntry;
}
