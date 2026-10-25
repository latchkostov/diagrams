import type { LiveKeyAction, LiveKeyContext } from "./types";

/**
 * Live view's Space, Enter and Esc, as one pure function: what the call site knows in, the level that takes the
 * key out. Esc backs out one level: whatever owns it first (slow motion, a recording, a text field or inline editor,
 * an open menu, dialog or Live panel), then the selection, the message trace, presentation (it leaves on its own
 * Esc), the highlighted path, and live view itself. The controller (controller.ts) journals each decision as a
 * live.key event (focus policy row L1); useLiveKeyboard runs it.
 *
 * | Row | Key   | Condition (first that holds)                        | Level                                       |
 * | --- | ----- | --------------------------------------------------- | ------------------------------------------- |
 * | X1  | Esc   | slow motion on, nothing selected                    | slowmo (its own Esc goes back to live)      |
 * | X2  | Esc   | a recording runs                                    | recording (its Esc stops it)                |
 * | X3  | Esc   | in a text field or an inline editor                 | editor                                      |
 * | X4  | Esc   | a menu, a dialog or a Live panel is open            | owner                                       |
 * | R1  | Esc   | any open readout, after higher-priority owners      | close-readout (one dismissal per press)      |
 * | X5  | Esc   | a selection, focus on the canvas                    | canvas (the canvas's Esc clears it)         |
 * | X6  | Esc   | a selection, focus elsewhere or in the trace card   | selection (live view clears it: no dead end)|
 * | X7  | Esc   | a message trace                                     | trace (ends it; presentation doesn't hear)  |
 * | X8  | Esc   | presenting                                          | presentation (it leaves on its own Esc)     |
 * | X9  | Esc   | a highlighted path                                  | path (cleared)                              |
 * | X10 | Esc   | live view can be left                               | exit                                        |
 * | X11 | Esc   | always on                                           | none                                        |
 * | S1  | Space | slow motion on (Space as " ")                       | slowmo (play / pause slow motion)           |
 * | S2  | Space | in a text field, an inline editor or a control      | none (its own Space)                        |
 * | S3  | Space | a held key's repeat                                 | repeat (swallowed)                          |
 * | S4  | Space | a note waits                                        | resume                                      |
 * | S5  | Space | otherwise                                           | toggle (play / pause)                       |
 * | N1  | Enter | in a text field, an inline editor or a control      | none (its own Enter)                        |
 * | R3  | Enter | a control on unrelated chrome, a card the pointer   | pin-readout (before the control: "Enter     |
 * |     |       | opened since the last key (`hovered`)               | pins"); a control in a card or item keeps it|
 * | R2  | Enter | focused wrapper, when naming does not own Enter     | pin-readout                                 |
 * | N2a | Enter | slow motion is capturing or replaying                 | slowmo (never continue Live narration)       |
 * | N2  | Enter | a note waits                                        | resume                                      |
 * | N3  | Enter | otherwise                                           | none                                        |
 *
 * Presentation keeps its own Esc (App); X8 only says live view leaves it alone. The levels that act (selection,
 * trace, path, exit, toggle, resume) never move focus themselves: a panel's own Esc returns focus by row D2.
 */
export function liveKeys(c: LiveKeyContext): LiveKeyAction {
  switch (c.key) {
    case "escape":
      if (c.slowMotion && !c.selection) return "slowmo";
      if (c.recording) return "recording";
      if (c.editable) return "editor";
      if (c.owner) return "owner";
      if (c.readout) return "close-readout";
      if (c.selection) return c.canvasFocus ? "canvas" : "selection";
      if (c.trace) return "trace";
      if (c.presenting) return "presentation";
      if (c.path) return "path";
      return c.alwaysOn ? "none" : "exit";
    case "space":
      if (c.slowMotion) return "slowmo";
      if (c.editable || c.control) return "none";
      if (c.repeat) return "repeat";
      return c.waiting ? "resume" : "toggle";
    case "enter":
      if (c.editable || (c.control && !c.hovered)) return "none";
      if (c.owner) return "none";
      if (c.slowMotion) return "slowmo";
      if (c.readoutTarget) return c.repeat ? "none" : "pin-readout";
      return c.waiting ? "resume" : "none";
  }
}
