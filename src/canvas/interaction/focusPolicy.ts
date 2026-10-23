import type { FocusCommand, FocusDecision, FocusEvent, FocusMove, FocusState, FocusTarget } from "./types";

/**
 * Where keyboard focus goes, as one pure function: the state and an event with its cause in, the next state and
 * exactly one command out. The controller (controller.ts) runs the command; nothing else moves focus.
 *
 * | Row | Event                               | Condition                       | Command / state                                        |
 * | --- | ----------------------------------- | ------------------------------- | ------------------------------------------------------ |
 * | M1  | menu.closed(escape)                 | it had an invoker               | focus the invoker after the commit (else the canvas)   |
 * | M2  | menu.closed(pick, outside, scroll,  | it had an invoker               | after the commit, the invoker only if focus was lost:  |
 * |     | blur, resize, gesture, command,     |                                 | an action or a press that moved focus wins             |
 * |     | replaced, unmount)                  |                                 |                                                        |
 * | M3  | menu.closed                         | no invoker, or a dialog         | keep (a dialog gives focus back to its own opener)     |
 * | M4  | menu.opened                         |                                 | keep (the menu takes focus inside itself)              |
 * | M5  | menu.closed(escape), a Live popover | it had an invoker               | focus the invoker now (else the canvas)                |
 * | M6  | menu.closed(any other), Live popover|                                 | keep (a pick or a press leaves focus where it put it)  |
 * | M7  | menu.closed(remote): a peer deleted |                                 | the canvas after the commit, if focus was lost (the    |
 * |     | what the menu was for               |                                 | invoker went with the target); extends R1              |
 * | K1  | selection.changed(keyboard)         | to a node                       | focus it next frame (it reveals itself); Tab stop := it|
 * | K2  | selection.changed(keyboard)         | to a connection                 | focus it next frame (it reveals itself)                |
 * | H1  | selection.changed(undo / redo)      | focus was on the canvas         | focus the selection once drawn (else the canvas)       |
 * | H2  | selection.changed(undo / redo)      | focus was elsewhere (toolbar)   | keep; the Tab stop moves to the selection              |
 * | P1  | selection.changed(palette)          | it added the node               | focus the node once drawn                              |
 * | P2  | selection.changed(palette)          | it went to the node             | focus the node now                                     |
 * | S1  | selection.changed(click, box,       |                                 | keep                                                   |
 * |     | placement, programmatic)            |                                 |                                                        |
 * | N1  | naming.done (Enter / Esc in a name) |                                 | focus the named item on the canvas now                 |
 * | I1  | inspector.field                     | a new request                   | focus the field once mounted for its item, all of its  |
 * |     |                                     |                                 | text selected (or the caret at the end); again a frame |
 * |     |                                     |                                 | later unless input came first                          |
 * | I2  | inspector.field                     | a request already taken         | keep                                                   |
 * | I3  | inspector.toggled(panel, selection) |                                 | keep                                                   |
 * | D1  | dialog.closed(checks)               |                                 | focus its opener now (else the canvas)                 |
 * | D2  | dialog.closed(livePanel)            |                                 | focus its opener now (else the Live bar's opener)      |
 * | D3  | dialog.closed(inject)               |                                 | focus its opener now (else the node it injects at)     |
 * | D6  | dialog.closed(room)                 |                                 | focus its opener now (else the canvas)                 |
 * | D4  | dialog.opened                      |                                 | focus its first field now, selecting its text         |
 * | D5  | dialog.tab                         | Tab crossed the modal's boundary | focus the other end now                              |
 * | D7  | node.details                       | Tab from a live node            | focus its scrollable details now                     |
 * | E1  | escape                              | from a node or a connection     | two frames later, back on it if focus was lost         |
 * | C1  | canvas.requested (the gallery)      |                                 | focus the canvas next frame                            |
 * | C2  | presenting                          |                                 | focus the canvas now if focus was lost                 |
 * | C3  | start.blank                         |                                 | focus the stencil search next frame                    |
 * | C4  | dependencies.hidden                 | focus was on a dependency       | focus the canvas now                                   |
 * | R1  | document.replaced (a peer's change) | focus was in the canvas         | next frame, the canvas if what had focus has gone      |
 * | W1  | room.waiting (a joiner's wait)      |                                 | the wait now, if focus was lost (its canvas went)      |
 * | W2  | room.ready (the room's canvas)      |                                 | the canvas next frame, if focus was lost (the wait     |
 * |     |                                     |                                 | went); focus moved elsewhere meanwhile stays           |
 * | W3  | room.status                         | Retry pressed                   | its surviving status now (Retry goes)                  |
 * | W4  | room.status                         | any other change                | keep: announced by the status, never a focus move      |
 * | L1  | live.key (Space, Enter, Esc)        | any level (liveKeys.ts)         | keep (Live's levels never move focus themselves)       |
 * | L2  | narration.waiting (presenting)      | no menu owns focus              | focus Continue now (else the canvas)                  |
 * | L3  | callout.closed                      | focus was inside it             | the canvas now, if focus was lost                      |
 * |     | callout.closed(undo)                | focus was in its Undo toast     | the canvas after commit, if focus was lost             |
 * | L5  | notice.closed                       | focus is inside a removed notice| its surviving status now, before the notice unmounts   |
 * | L4  | panel.field (a Live panel's field)  |                                 | focus it once the panel lists it, all of it selected   |
 * | F1  | focus.entered, focus.resolved       |                                 | keep; Tab stop := that node                            |
 * | F2  | focus.ran                           | the move goes again             | focus it again next frame, if not there already        |
 * | F3  | focus.done                          |                                 | keep; nothing pending                                  |
 * | F4  | input                               | the pending move is a retry     | keep; the retry stands down                            |
 * | G1  | gesture.ended(drop/escape/cancel/blur/unmount/superseded) |          | keep                                                   |
 * | G2  | gesture.ended(remote)               | focus lost                      | canvas next frame, onlyIfLost                         |
 *
 * Every row is the same on macOS (Control-click opens a context menu) as elsewhere: the platform is an input the
 * call site gives (menu.opened, menu.closed), never inferred here. At most one move is pending: a newer move
 * replaces it, and "keep" leaves it pending. Conditional peer recovery can run beside it without consuming it.
 */
export function focusPolicy(state: FocusState, event: FocusEvent): FocusDecision {
  const keep = (patch: Partial<FocusState> = {}): FocusDecision => ({
    state: { ...state, ...patch },
    command: { type: "keep" },
  });
  const move = (m: Omit<FocusMove, "type">, patch: Partial<FocusState> = {}): FocusDecision => {
    const command: FocusMove = { type: "focus", ...m };
    return { state: { ...state, ...patch, pending: command }, command };
  };
  const canvas: FocusTarget = { kind: "canvas" };
  switch (event.type) {
    case "gesture.ended":
      return event.reason === "remote"
        ? { state, command: { type: "recover", target: canvas, when: "frame", onlyIfLost: true } }
        : keep();
    case "menu.closed": {
      const openMenus = [...(state.openMenus ?? [])];
      const index = openMenus.lastIndexOf(event.kind);
      if (index >= 0) openMenus.splice(index, 1);
      state = { ...state, openMenus };
      // A peer deleted the target: its invoker went with it, so the canvas takes the keyboard back (M7).
      if (event.reason === "remote" && event.kind !== "live" && event.kind !== "dialog")
        return move({ target: canvas, when: "commit", onlyIfLost: true });
      if (!event.invoker || event.kind === "dialog") return keep();
      if (event.kind === "live")
        return event.reason === "escape"
          ? move({ target: { kind: "element", handle: event.invoker }, when: "now", fallback: canvas })
          : keep();
      if (event.reason === "escape")
        return move({ target: { kind: "element", handle: event.invoker }, when: "commit", fallback: canvas });
      return move({ target: { kind: "element", handle: event.invoker }, when: "commit", onlyIfLost: true });
    }
    case "menu.opened":
      return keep({ openMenus: [...(state.openMenus ?? []), event.kind] });
    case "selection.changed": {
      const { cause, target } = event;
      if (cause === "keyboard" && target)
        return move(
          { target: { kind: target.kind, id: target.id }, when: "frame", revealed: true },
          target.kind === "node" ? { roving: target.id } : {},
        );
      if ((cause === "undo" || cause === "redo") && event.selection) {
        const selection: FocusTarget = { kind: "selection", ...event.selection };
        if (event.origin === "canvas")
          return move({ target: selection, when: "measured", fallback: canvas, revealed: true });
        return { state, command: { type: "roving", target: selection, when: "frame" } };
      }
      if (cause === "palette" && target)
        return move(
          event.placed
            ? { target: { kind: target.kind, id: target.id }, when: "measured", fresh: true }
            : { target: { kind: target.kind, id: target.id }, when: "now" },
        );
      return keep();
    }
    case "naming.done":
      return move({ target: { kind: "item", id: event.flowId }, when: "now" });
    case "inspector.field":
      if (event.seq <= state.fieldSeq) return keep();
      return move(
        {
          target: { kind: "field", name: event.name, owner: event.owner },
          when: "ready",
          select: event.caret === "end" ? "end" : "all",
          again: true,
          claim: event.claim,
        },
        { fieldSeq: event.seq },
      );
    case "inspector.toggled":
      return keep();
    case "dialog.opened":
      return move({ target: { kind: "element", handle: event.first }, when: "now", select: "all" });
    case "node.details":
    case "dialog.tab":
      return move({ target: { kind: "element", handle: event.target }, when: "now" });
    case "dialog.closed": {
      const back: FocusTarget =
        event.dialog === "livePanel"
          ? { kind: "panelOpener" }
          : event.dialog === "inject" && event.node
            ? { kind: "node", id: event.node }
            : canvas;
      return move({
        target: event.opener ? { kind: "element", handle: event.opener } : back,
        when: "now",
        fallback: back,
      });
    }
    case "live.key":
      return keep();
    case "room.waiting":
      return move({ target: { kind: "element", handle: event.region }, when: "now", onlyIfLost: true });
    case "room.ready":
      return move({ target: canvas, when: "frame", onlyIfLost: true });
    case "room.status":
      return event.retry
        ? move({ target: { kind: "element", handle: event.status }, when: "now", fallback: canvas })
        : keep();
    case "narration.waiting":
      if (state.openMenus?.length) return keep();
      return move({ target: { kind: "element", handle: event.resume }, when: "now", fallback: canvas });
    case "callout.closed":
      return event.hadFocus ? move({ target: canvas, when: event.undo ? "commit" : "now", onlyIfLost: true }) : keep();
    case "notice.closed":
      return move({ target: { kind: "element", handle: event.status }, when: "now" });
    case "panel.field":
      return move({
        target: { kind: "panelField", panel: event.panel, field: event.field },
        when: "ready",
        select: "all",
      });
    case "escape":
      if (!event.from) return keep();
      return move({ target: { kind: "element", handle: event.from }, when: "frames2", onlyIfLost: true });
    case "canvas.requested":
      return move({ target: canvas, when: "frame" });
    case "presenting":
      return move({ target: canvas, when: "now", onlyIfLost: true });
    case "start.blank":
      return move({ target: { kind: "paletteSearch" }, when: "frame" });
    case "dependencies.hidden":
      return event.focusOnDependency ? move({ target: canvas, when: "now" }) : keep();
    case "document.replaced":
      if (!event.active) return keep();
      // A user move gets its chance first, but recovery must still run if its focused owner disappears.
      // A parked request can survive while the canvas takes focus in the meantime.
      if (state.pending && !state.pending.ifGone)
        return {
          state,
          command: { type: "recover", target: canvas, when: "frame", onlyIfLost: true, ifGone: event.active },
        };
      return move({ target: canvas, when: "frame", onlyIfLost: true, ifGone: event.active });
    case "focus.entered":
    case "focus.resolved":
      return keep({ roving: event.id });
    case "focus.ran": {
      const ran = state.pending;
      if (!ran?.again) return keep({ pending: null });
      // The second attempt: only if something took focus back meanwhile, and without selecting the text again.
      return move({ ...ran, when: "frame", again: false, retry: true, claim: undefined, select: undefined });
    }
    case "focus.done":
      return keep({ pending: null });
    case "input":
      return state.pending?.retry ? keep({ pending: null }) : keep();
  }
}

export function initialFocus(): FocusState {
  return { pending: null, fieldSeq: 0 };
}

/** The move waiting to run, if any (a retry is not "pending" for readiness: its first attempt has run). */
export function pendingMove(state: FocusState): FocusMove | null {
  return state.pending && !state.pending.retry ? state.pending : null;
}

/** For the journal and tests: the command as a short string ("focus:node:a@frame", "keep"). */
export function describe(command: FocusCommand): string {
  if (command.type === "keep") return "keep";
  return `${command.type}:${describeTarget(command.target)}@${command.when}`;
}

export function describeTarget(target: FocusTarget): string {
  switch (target.kind) {
    case "node":
    case "edge":
    case "item":
      return `${target.kind}:${target.id}`;
    case "field":
      return `field:${target.name}`;
    case "panelField":
      return `panelField:${target.field}`;
    default:
      return target.kind;
  }
}
