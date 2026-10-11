import { describe, expect, it } from "vitest";
import { coerce, defaultsOf, readValues, writeValues } from "./controls";
import type { ControlDef } from "./types";

const controls: ControlDef[] = [
  { type: "number", key: "nodes", label: "Nodes", default: 50, min: 1, max: 300 },
  { type: "boolean", key: "groups", label: "Groups", default: false },
  { type: "select", key: "dir", label: "Direction", default: "LR", options: [{ value: "LR", label: "LR" }, { value: "TB", label: "TB" }] },
  { type: "text", key: "label", label: "Label", default: "hello" },
];

describe("lab controls", () => {
  it("defaults", () => {
    expect(defaultsOf(controls)).toEqual({ nodes: 50, groups: false, dir: "LR", label: "hello" });
    expect(defaultsOf()).toEqual({});
  });

  it("coerces and clamps URL values, falling back on junk", () => {
    expect(coerce(controls[0], "150")).toBe(150);
    expect(coerce(controls[0], "9999")).toBe(300);
    expect(coerce(controls[0], "abc")).toBe(50);
    expect(coerce(controls[0], "")).toBe(50);
    expect(coerce(controls[1], "1")).toBe(true);
    expect(coerce(controls[1], "false")).toBe(false);
    expect(coerce(controls[1], "maybe")).toBe(false);
    expect(coerce(controls[2], "TB")).toBe("TB");
    expect(coerce(controls[2], "XX")).toBe("LR");
    expect(coerce(controls[3], "")).toBe("");
    expect(coerce(controls[3], null)).toBe("hello");
  });

  it("reads values from a query string", () => {
    const v = readValues(controls, new URLSearchParams("view=lab&preset=stress&nodes=150&groups=1&dir=TB&other=x"));
    expect(v).toEqual({ nodes: 150, groups: true, dir: "TB", label: "hello" });
  });

  it("writes only non-default values and keeps reserved / kept params", () => {
    const p = new URLSearchParams("view=lab&preset=old&nodes=10&theme=dark&stale=1");
    writeValues(p, "stress", controls, { nodes: 150, groups: false, dir: "TB", label: "hello" }, new Set(["theme"]));
    expect(Object.fromEntries(p)).toEqual({ view: "lab", preset: "stress", nodes: "150", dir: "TB", theme: "dark" });
  });

  it("round-trips through the URL", () => {
    const values = { nodes: 7, groups: true, dir: "TB", label: "a b&c" };
    const p = writeValues(new URLSearchParams(), "x", controls, values);
    expect(readValues(controls, new URLSearchParams(p.toString()))).toEqual(values);
  });
});
