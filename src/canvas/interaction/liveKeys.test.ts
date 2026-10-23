import { describe, expect, it } from "vitest";
import { liveKeys } from "./liveKeys";
import type { LiveKey, LiveKeyAction, LiveKeyContext } from "./types";

const ctx = (patch: Partial<LiveKeyContext> = {}): LiveKeyContext => ({
  key: "escape",
  repeat: false,
  slowMotion: false,
  recording: false,
  editable: false,
  control: false,
  owner: false,
  selection: false,
  canvasFocus: false,
  trace: false,
  presenting: false,
  path: false,
  alwaysOn: false,
  waiting: false,
  ...patch,
});

describe("liveKeys: the levels, row by row", () => {
  it.each<[string, Partial<LiveKeyContext>, LiveKeyAction]>([
    ["X1 slow motion, nothing selected: its own Esc", { slowMotion: true, trace: true }, "slowmo"],
    ["X1 slow motion with a selection: the selection first", { slowMotion: true, selection: true }, "selection"],
    ["X2 a recording owns Esc", { recording: true, selection: true, trace: true }, "recording"],
    ["X3 a text field or inline editor owns Esc", { editable: true, owner: true, trace: true }, "editor"],
    ["X4 an open menu, dialog or Live panel owns Esc", { owner: true, selection: true }, "owner"],
    ["readout Esc before selection", { readout: true, selection: true }, "close-readout"],
    ["recording owns Esc before pinned readout", { readout: true, recording: true }, "recording"],
    ["editor owns Esc before readout", { readout: true, editable: true }, "editor"],
    ["panel owns Esc before readout", { readout: true, owner: true }, "owner"],
    ["Enter pins an unselected wrapper", { key: "enter", readoutTarget: true }, "pin-readout"],
    ["Enter activates a node control", { key: "enter", readoutTarget: true, control: true }, "none"],
    ["a focused node pins while narration waits", { key: "enter", readoutTarget: true, waiting: true }, "pin-readout"],
    ["held Enter does not pin or resume", { key: "enter", readoutTarget: true, repeat: true, waiting: true }, "none"],
    ["X5 a selection, focus on the canvas: the canvas clears it", { selection: true, canvasFocus: true }, "canvas"],
    ["X6 a selection, focus off the canvas: live view clears it", { selection: true, trace: true }, "selection"],
    ["X7 a message trace: it ends (before presentation)", { trace: true, presenting: true, path: true }, "trace"],
    ["X8 presenting: presentation leaves on its own Esc", { presenting: true, path: true }, "presentation"],
    ["X9 a highlighted path: cleared", { path: true }, "path"],
    ["X10 nothing else: live view ends", {}, "exit"],
    ["X11 always on: nothing", { alwaysOn: true }, "none"],
    ["S1 slow motion has its own Space", { key: "space", slowMotion: true, editable: true }, "slowmo"],
    ["S2 Space in a text field: its own", { key: "space", editable: true, waiting: true }, "none"],
    ["S2 Space on a button: its own", { key: "space", control: true }, "none"],
    ["S3 a held Space: swallowed", { key: "space", repeat: true, waiting: true }, "repeat"],
    ["S4 Space with a note waiting: continue", { key: "space", waiting: true }, "resume"],
    ["S5 Space: play or pause", { key: "space" }, "toggle"],
    ["N1 Enter on a control: its own", { key: "enter", control: true, waiting: true }, "none"],
    ["N2 Enter with a note waiting: continue", { key: "enter", waiting: true, slowMotion: true }, "resume"],
    ["N3 Enter otherwise: nothing", { key: "enter", trace: true }, "none"],
  ])("%s", (_name, patch, expected) => {
    expect(liveKeys(ctx(patch))).toBe(expected);
  });
});

// ---------------------------------------------------------------- every context

const FLAGS = [
  "repeat",
  "slowMotion",
  "recording",
  "editable",
  "control",
  "owner",
  "selection",
  "canvasFocus",
  "trace",
  "presenting",
  "path",
  "alwaysOn",
  "waiting",
] as const;

function* contexts(): Generator<LiveKeyContext> {
  for (const key of ["space", "enter", "escape"] as LiveKey[])
    for (let bits = 0; bits < 1 << FLAGS.length; bits++) {
      const c = ctx({ key });
      FLAGS.forEach((f, i) => (c[f] = !!(bits & (1 << i))));
      yield c;
    }
}

const OWNED = new Set<LiveKeyAction>(["slowmo", "recording", "editor", "owner", "canvas", "presentation", "none"]);

describe("liveKeys: invariants over every context", () => {
  it("holds for all 24,576 contexts", () => {
    let n = 0;
    for (const c of contexts()) {
      n++;
      const a = liveKeys(c);
      // An owner of the key (a recording, a text field, an open menu or panel) means live view leaves it alone.
      if (c.key === "escape" && (c.recording || c.editable || c.owner)) expect(OWNED.has(a)).toBe(true);
      // Presentation keeps its own Esc: live view never ends while presenting, nor when it's always on.
      if (c.presenting || c.alwaysOn) expect(a).not.toBe("exit");
      // Live view ends only when nothing else is left to back out of.
      if (a === "exit") expect(c.selection || c.trace || c.path || c.owner || c.editable).toBe(false);
      // Esc never plays, pauses or continues; Space and Enter never back out of anything.
      if (c.key === "escape") expect(["toggle", "resume", "repeat"]).not.toContain(a);
      else expect(["selection", "trace", "path", "exit", "canvas", "owner", "presentation"]).not.toContain(a);
      // A control's or a text field's own Space and Enter win (slow motion's Space aside).
      if (c.key !== "escape" && (c.editable || c.control) && a !== "slowmo") expect(a).toBe("none");
    }
    expect(n).toBe(3 * (1 << FLAGS.length));
  });

  it("Esc backs out one level per press: selection, trace, path, then live view", () => {
    let c = ctx({ selection: true, trace: true, path: true });
    const seen: LiveKeyAction[] = [];
    for (let i = 0; i < 5; i++) {
      const a = liveKeys(c);
      seen.push(a);
      if (a === "exit") break;
      c = { ...c, [a === "selection" ? "selection" : a]: false };
    }
    expect(seen).toEqual(["selection", "trace", "path", "exit"]);
  });
});
