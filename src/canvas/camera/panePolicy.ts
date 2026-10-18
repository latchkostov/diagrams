import type {
  CameraCommand,
  CameraEvent,
  CameraMode,
  Decision,
  LiveCause,
  LiveFitReason,
  LiveRoom,
  PaneCause,
  PaneWork,
  PolicyState,
} from "./types";

/**
 * The camera's rules, as one pure function: the state and an event with its cause in, the next state and at
 * most one command out. The controller (controller.ts) runs the commands; nothing else decides.
 *
 * | Row | Event                         | Condition                                  | Command / state                         |
 * | --- | ----------------------------- | ------------------------------------------ | --------------------------------------- |
 * | P1  | pane.changed(panel)           | edit or live view                          | pending := panel                        |
 * | S1  | pane.changed(selection/place) | edit or live                               | pending := that cause                   |
 * | S2  | selection.changed             | the canvas's pane work pending             | pending := that cause (rule b)          |
 * | X1  | pane.changed(any)             | presenting                                 | no new work                             |
 * | M1  | menu.opened                   |                                            | menu := kind; pane work waits           |
 * | M2  | menu.closed                   |                                            | menu := none; pending runs once settled |
 * | R1  | pane.settled                  | pending panel, edit, owner fit             | fit (refit)                             |
 * | R2  | pane.settled                  | Zoom to selection owns the view            | nothing                                 |
 * | R3  | pane.settled                  | pending selection/placement, covered       | reveal (selection), owner unchanged     |
 * | R4  | pane.settled                  | pending selection/placement, not covered   | nothing                                 |
 * | R5  | pane.settled                  | pending panel, edit, owner manual          | reveal with edges if covered            |
 * | R6  | pane.settled                  | as R5, nothing selected, centre off        | center                                  |
 * | Z1  | zoomToSelection               |                                            | zoomToSelection; owner manual; priority |
 * | Z2  | reveal.requested              | Zoom to selection owns the view            | nothing                                 |
 * | Z3  | reveal.requested              | otherwise                                  | reveal (selection)                      |
 * | I1  | input                         |                                            | Zoom to selection's priority ends       |
 * | U1  | user.moved, zoom100           |                                            | owner manual (zoom100: zoom100)         |
 * | F1  | fit, mode.changed             | (not slow motion staying live, W3)         | fit; owner fit; pending := none         |
 * | F4  | mode.changed                  | live view ends (presenting or not)         | Live's room, slow motion end; F1        |
 * | F2  | fullscreen.changed            | presenting, owner fit                      | fit                                     |
 * | F3  | overlay.opened                | edit mode, owner fit                       | fit                                     |
 * | L1  | narration(focus)              |                                            | owner narration; pending := narration   |
 * | L2  | narration(no focus)           | a focused note ended                       | owner fit; pending := narration         |
 * | L3  | live.panel, live.card         | changed (the card: with no panel open)     | pending := live.panel / live.card       |
 * | L4  | live.added                    |                                            | pending := live.added                   |
 * | L5  | pane.settled                  | Live's work, or live panel work, owner fit | liveFit                                 |
 * | L6  | pane.settled                  | as L5, owner narration                     | noteFit (the note's focus)              |
 * | L7  | pane.settled                  | live panel work, owner manual              | reveal with edges if covered            |
 * | L8  | pane.settled                  | live.panel, live.card, owner manual        | nothing                                 |
 * | L9  | pane.settled                  | live.added                                 | liveFit clear of the panel, any owner   |
 * | W1  | slowmo(on)                    |                                            | owner slowmo; resume := owner           |
 * | W1a | slowmo(on)                    | starting with pending work                 | pending := slowmo.take (fold the work) |
 * | W1b | pane.changed(panel)           | slow motion already on, not presenting     | pending := panel; W5 owns its replay    |
 * | W2  | slowmo(off)                   |                                            | owner := resume (if still slowmo);      |
 * |     |                               |                                            | restore the view from before            |
 * | W3  | slowmo.take, fullscreen,      | slow motion on                             | owner slowmo (take); pending := take    |
 * |     | mode.changed (still live)     |                                            |                                         |
 * | W4  | pane.settled                  | pending slowmo.take                        | slowmoPlan                              |
 * | W5  | pane.settled                  | pending panel, slow motion on, any mode    | slowmoPane (it holds or replans)        |
 * | W6  | slowmo.follow                 | owner slowmo, no work waits for the pane   | follow                                  |
 * | W7  | narration, live.*             | slow motion on                             | the room only: slow motion's camera     |
 *
 * Pending work is replayed with the owner at replay time (R1, R5, L5–L8), runs exactly once (the settled event
 * clears it), and a selection or placement never refits (S1, S2, R3, R4). Live's own work (L1–L4) doesn't wait
 * for menus and isn't replaced by a selection; live panel work it would replace stays (it does the same fits).
 */
export function decide(state: PolicyState, event: CameraEvent): Decision {
  const next = (patch: Partial<PolicyState>, ...commands: CameraCommand[]): Decision => ({
    state: { ...state, ...patch },
    commands,
  });
  switch (event.type) {
    case "pane.changed": {
      if (state.mode === "present") return next({});
      // A take, or a node Live added, waiting for the pane fits for the new one too; and a selection doesn't
      // replace Live's work (a panel change does: it makes the same refit).
      const kept = state.pending && !isPaneCause(state.pending.cause);
      if (kept && (event.cause !== "panel" || KEEPS.has(state.pending!.cause))) return next({});
      return next({ pending: { cause: event.cause } });
    }
    case "selection.changed":
      if (!state.pending || !isPaneCause(state.pending.cause)) return next({});
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
      // Slow motion between live view and presenting keeps the view and replans its take for the new pane.
      if (state.slowmo && event.live)
        return next({ mode: event.mode, pending: { cause: "slowmo.take" }, zoomPriority: false });
      // Leaving live view, presenting or not, ends Live's room and slow motion with it (F4): the normal fit.
      return next(
        {
          owner: "fit",
          pending: null,
          mode: event.mode,
          zoomPriority: false,
          ...(event.live ? {} : { live: CLEAR, slowmo: false }),
        },
        { type: "fit", reason: "mode" },
      );
    case "fullscreen.changed":
      if (state.slowmo) return next({ pending: { cause: "slowmo.take" } });
      return state.mode === "present" && state.owner === "fit"
        ? next({}, { type: "fit", reason: "fullscreen" })
        : next({});
    case "overlay.opened":
      return state.mode === "edit" && state.owner === "fit" ? next({}, { type: "fit", reason: "checks" }) : next({});
    case "narration": {
      const live = { ...state.live, focus: event.focus };
      if (state.slowmo) return next({ live });
      if (event.focus.length)
        return next({ live, owner: "narration", zoomPriority: false, pending: { cause: "narration" } });
      if (!state.live.focus.length) return next({ live });
      return next({ live, owner: "fit", zoomPriority: false, pending: { cause: "narration" } });
    }
    case "live.panel":
    case "live.card": {
      const key = event.type === "live.panel" ? "panel" : "card";
      if (event.open === state.live[key]) return next({});
      const live = { ...state.live, [key]: event.open };
      // The trace card refits only with no side panel open (the panel's column covers its place).
      if (state.slowmo || (key === "card" && state.live.panel)) return next({ live });
      return next({ live, pending: state.pending?.cause === "panel" ? state.pending : { cause: event.type } });
    }
    case "live.added":
      return state.slowmo ? next({}) : next({ pending: { cause: "live.added", panel: event.panel } });
    case "slowmo": {
      if (event.on)
        return state.slowmo
          ? next({})
          : next({
              slowmo: true,
              resume: state.owner,
              owner: "slowmo",
              zoomPriority: false,
              // The take plans for the settled pane; an earlier refit or reveal must not take the view back.
              pending: state.pending ? { cause: "slowmo.take" } : null,
            });
      if (!state.slowmo) return next({});
      const owner = state.owner === "slowmo" ? state.resume : state.owner;
      const pending = state.pending?.cause === "slowmo.take" ? null : state.pending;
      const restore: CameraCommand[] = event.restore ? [{ type: "restore", view: event.restore }] : [];
      return next({ slowmo: false, owner, pending }, ...restore);
    }
    case "slowmo.take":
      if (!state.slowmo) return next({});
      return next({ owner: "slowmo", zoomPriority: false, pending: { cause: "slowmo.take" } });
    case "slowmo.follow":
      // While the pane settles the frontier is measured against a pane that is still changing: wait for W4, W5.
      if (!state.slowmo || state.owner !== "slowmo" || state.pending) return next({});
      return next({}, { type: "follow", view: event.view });
    case "reveal.requested":
      if (state.zoomPriority) return next({});
      return next({}, { type: "reveal", cause: event.cause, withEdges: false });
    case "pane.settled": {
      const work = state.pending;
      if (!work || (state.menu && waitsForMenu(work))) return next({});
      const done = { pending: null };
      if (!isPaneCause(work.cause)) return next(done, ...liveWork(state, work as LiveWork));
      if (work.cause === "panel" && state.slowmo)
        return next(done, { type: "slowmoPane", following: state.owner === "slowmo" });
      if (work.cause === "panel" && state.mode !== "edit") {
        if (state.owner !== "manual") return next(done, ...refit(state, "pane"));
        // L7: as Live's manual pane changes always did, the selection and its connections only (no centring).
        if (state.zoomPriority || !event.selection || !event.coveredWithEdges) return next(done);
        return next(done, { type: "reveal", cause: "panel", withEdges: true });
      }
      if (state.mode === "present") return next(done);
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

type LiveWork = Exclude<PaneWork, { cause: PaneCause }>;

const CLEAR: LiveRoom = { panel: false, card: false, focus: [] };
/** Live's work a pane change never replaces: it fits for whatever pane settles. */
const KEEPS = new Set<string>(["slowmo.take", "live.added"]);

export function isPaneCause(cause: PaneCause | LiveCause): cause is PaneCause {
  return cause === "panel" || cause === "selection" || cause === "placement";
}

/** The canvas's pane work waits for menus; Live's own work doesn't (it never did). */
export function waitsForMenu(work: PaneWork) {
  return isPaneCause(work.cause);
}

/** Live's own work, once the pane has settled. */
function liveWork(state: PolicyState, work: LiveWork): CameraCommand[] {
  switch (work.cause) {
    case "slowmo.take":
      return state.slowmo ? [{ type: "slowmoPlan" }] : [];
    case "live.added":
      return state.slowmo ? [] : [{ type: "liveFit", reason: "added", panel: work.panel, card: false }];
    case "narration":
      return refit(state, "narration");
    case "live.panel":
      return refit(state, "panel");
    case "live.card":
      return refit(state, "card");
  }
}

/** Live's refit for a changed room: the note's focus while it narrates, else the whole diagram (L5, L6, L8). */
function refit(state: PolicyState, reason: LiveFitReason): CameraCommand[] {
  if (state.slowmo || state.owner === "manual" || state.owner === "slowmo") return [];
  const { panel, card, focus } = state.live;
  if (state.owner === "narration" && focus.length) return [{ type: "noteFit", reason, focus, panel, card }];
  return [{ type: "liveFit", reason, panel, card }];
}

export function initialPolicy(mode: CameraMode = "edit"): PolicyState {
  return {
    owner: "fit",
    mode,
    menu: null,
    pending: null,
    zoomPriority: false,
    live: CLEAR,
    slowmo: false,
    resume: "fit",
  };
}

/** Whether `state` holds work waiting for the pane, and whether a menu defers it. */
export function pendingPhase(state: PolicyState): "pending" | "deferred" | null {
  if (!state.pending) return null;
  return state.menu && waitsForMenu(state.pending) ? "deferred" : "pending";
}
