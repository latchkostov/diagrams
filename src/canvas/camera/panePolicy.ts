import type { CameraCommand, CameraEvent, CameraMode, Decision, PolicyState } from "./types";

/**
 * The camera's rules, as one pure function: the state and an event with its cause in, the next state and at
 * most one command out. The controller (controller.ts) runs the commands; nothing else decides.
 *
 * | Row | Event                         | Condition                                  | Command / state                         |
 * | --- | ----------------------------- | ------------------------------------------ | --------------------------------------- |
 * | P1  | pane.changed(panel)           | edit mode                                  | pending := panel                        |
 * | P2  | pane.changed(panel)           | live view (Live refits its own panels)     | pending := none                         |
 * | S1  | pane.changed(selection/place) | edit or live                               | pending := that cause                   |
 * | S2  | selection.changed             | work pending                               | pending := that cause (rule b)          |
 * | X1  | pane.changed(any)             | presenting                                 | pending := none                         |
 * | M1  | menu.opened                   |                                            | menu := kind; pending waits             |
 * | M2  | menu.closed                   |                                            | menu := none; pending runs once settled |
 * | R1  | pane.settled                  | pending panel, owner fit                   | fit (refit)                             |
 * | R2  | pane.settled                  | Zoom to selection owns the view            | nothing                                 |
 * | R3  | pane.settled                  | pending selection/placement, covered       | reveal (selection), owner unchanged     |
 * | R4  | pane.settled                  | pending selection/placement, not covered   | nothing                                 |
 * | R5  | pane.settled                  | pending panel, owner manual or narration   | reveal with edges if covered            |
 * | R6  | pane.settled                  | as R5, nothing selected, centre off        | center                                  |
 * | Z1  | zoomToSelection               |                                            | zoomToSelection; owner manual; priority |
 * | Z2  | reveal.requested              | Zoom to selection owns the view            | nothing                                 |
 * | Z3  | reveal.requested              | otherwise                                  | reveal (selection)                      |
 * | I1  | input                         |                                            | Zoom to selection's priority ends       |
 * | U1  | user.moved, zoom100           |                                            | owner manual (zoom100: zoom100)         |
 * | F1  | fit, mode.changed             |                                            | fit; owner fit; pending := none         |
 * | F2  | fullscreen.changed            | presenting, owner fit                      | fit                                     |
 * | F3  | overlay.opened                | edit mode, owner fit                       | fit                                     |
 * | N1  | narration                     |                                            | owner narration (or fit when it ends)   |
 *
 * Pending work is replayed with the owner at replay time (R1, R5), runs exactly once (the settled event
 * clears it), and a selection or placement never refits (S1, S2, R3, R4).
 */
export function decide(state: PolicyState, event: CameraEvent): Decision {
  const next = (patch: Partial<PolicyState>, ...commands: CameraCommand[]): Decision => ({
    state: { ...state, ...patch },
    commands,
  });
  switch (event.type) {
    case "pane.changed": {
      const lastCause = event.cause;
      if (state.mode === "present") return next({ lastCause, pending: null });
      if (event.cause === "panel" && state.mode === "live") return next({ lastCause, pending: null });
      return next({ lastCause, pending: { cause: event.cause } });
    }
    case "selection.changed":
      if (!state.pending) return next({});
      return next({ pending: { cause: event.cause } });
    case "menu.opened":
      return next({ menu: event.kind });
    case "menu.closed":
      return next({ menu: null });
    case "input":
      return next({ zoomPriority: false });
    case "user.moved":
      return next({ owner: "manual", zoomPriority: false });
    case "zoom100":
      return next({ owner: "manual", zoomPriority: false }, { type: "zoom100" });
    case "zoomToSelection":
      return next({ owner: "manual", zoomPriority: true }, { type: "zoomToSelection" });
    case "fit":
      return next({ owner: "fit", pending: null, zoomPriority: false }, { type: "fit", reason: event.reason });
    case "mode.changed":
      return next(
        { owner: "fit", pending: null, mode: event.mode, zoomPriority: false },
        { type: "fit", reason: "mode" },
      );
    case "fullscreen.changed":
      return state.mode === "present" && state.owner === "fit"
        ? next({}, { type: "fit", reason: "fullscreen" })
        : next({});
    case "overlay.opened":
      return state.mode === "edit" && state.owner === "fit" ? next({}, { type: "fit", reason: "checks" }) : next({});
    case "narration":
      return next({ owner: event.focus ? "narration" : "fit" });
    case "reveal.requested":
      if (state.zoomPriority) return next({});
      return next({}, { type: "reveal", cause: event.cause, withEdges: false });
    case "pane.settled": {
      const work = state.pending;
      if (!work || state.menu) return next({});
      const done = { pending: null };
      if (!canRun(state.mode, work.cause)) return next(done);
      if (work.cause === "panel" && state.owner === "fit") return next(done, { type: "fit", reason: "pane" });
      if (state.zoomPriority) return next(done);
      if (work.cause !== "panel")
        return event.covered ? next(done, { type: "reveal", cause: work.cause, withEdges: false }) : next(done);
      if (event.selection)
        return event.coveredWithEdges ? next(done, { type: "reveal", cause: "panel", withEdges: true }) : next(done);
      return event.centreOff ? next(done, { type: "center" }) : next(done);
    }
  }
}

/** Presenting keeps its own fit; in live view the canvas only reveals selections (Live refits its panels). */
function canRun(mode: CameraMode, cause: "panel" | "selection" | "placement") {
  return mode === "edit" || (mode === "live" && cause !== "panel");
}

export function initialPolicy(mode: CameraMode = "edit"): PolicyState {
  return { owner: "fit", mode, menu: null, pending: null, zoomPriority: false, lastCause: "panel" };
}

/** Whether `state` holds work waiting for the pane, and whether a menu defers it. */
export function pendingPhase(state: PolicyState): "pending" | "deferred" | null {
  if (!state.pending) return null;
  return state.menu ? "deferred" : "pending";
}
