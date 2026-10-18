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
 * | E1  | escape                              | from a node or a connection     | two frames later, back on it if focus was lost         |
 * | C1  | canvas.requested (the gallery)      |                                 | focus the canvas next frame                            |
 * | C2  | presenting                          |                                 | focus the canvas now if focus was lost                 |
 * | C3  | start.blank                         |                                 | focus the stencil search next frame                    |
 * | C4  | dependencies.hidden                 | focus was on a dependency       | focus the canvas now                                   |
 * | R1  | document.replaced (a peer's change) | focus was in the canvas         | next frame, the canvas if what had focus has gone      |
 * | F1  | focus.entered, focus.resolved       |                                 | keep; Tab stop := that node                            |
 * | F2  | focus.ran                           | the move goes again             | focus it again next frame, if not there already        |
 * | F3  | focus.done                          |                                 | keep; nothing pending                                  |
 * | F4  | input                               | the pending move is a retry     | keep; the retry stands down                            |
 *
 * Every row is the same on macOS (Control-click opens a context menu) as elsewhere: the platform is an input the
 * call site gives (menu.opened, menu.closed), never inferred here. At most one move is pending: a newer move
 * replaces it, and "keep" leaves it pending.
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
    case "menu.closed":
      if (!event.invoker || event.kind === "dialog") return keep();
      if (event.reason === "escape")
        return move({ target: { kind: "element", handle: event.invoker }, when: "commit", fallback: canvas });
      return move({ target: { kind: "element", handle: event.invoker }, when: "commit", onlyIfLost: true });
    case "menu.opened":
      return keep();
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
        return move({ target: { kind: target.kind, id: target.id }, when: event.placed ? "measured" : "now" });
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
    case "dialog.closed":
      return move({
        target: event.opener ? { kind: "element", handle: event.opener } : canvas,
        when: "now",
        fallback: canvas,
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
    default:
      return target.kind;
  }
}
