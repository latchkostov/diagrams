import { describe, expect, it } from "vitest";
import { patchProps, readPath } from "./paths";
import { holds } from "./checks";
import type { DiagramFile } from "../model/types";
import type { Check, PropPatch } from "./types";

const settings = () => [{ key: "Host" }, { key: "Port", secret: false }, { key: "User" }, { key: "Pool" }];

describe("prop paths", () => {
  const props = { settings: settings(), retry: { attempts: 2 }, list: [[1, 2]] };
  it("walks object keys, array indices and a matching item", () => {
    expect(readPath(props, ["settings", 1, "secret"])).toBe(false);
    expect(readPath(props, ["settings", { where: { key: "Pool" } }, "key"])).toBe("Pool");
    expect(readPath(props, ["retry", "attempts"])).toBe(2);
    expect(readPath(props, ["list", 0, 1])).toBe(2);
  });
  it("is undefined for anything not there, and never reads the prototype or a list by key", () => {
    for (const path of [
      ["settings", 4],
      ["settings", -1],
      ["settings", 1.5],
      ["settings", "0"],
      ["settings", "length"],
      ["retry", 0],
      ["retry", "constructor"],
      ["constructor"],
      ["__proto__"],
      ["settings", { where: { key: "Missing" } }],
      ["missing", "deeper"],
    ] as const)
      expect(readPath(props, path), JSON.stringify(path)).toBeUndefined();
  });
});

describe("edit-preserving patches", () => {
  const token = () => "Token";
  it("appends a missing item and leaves the learner's own items as they are", () => {
    const before = { settings: settings(), other: { kept: true } };
    const patch: PropPatch = { op: "ensureItem", path: ["settings"], match: { key: token } };
    const changed = patchProps(before, [patch])!;
    expect(Object.keys(changed)).toEqual(["settings"]);
    expect(changed.settings).toEqual([...settings(), { key: "Token" }]);
    (changed.settings as unknown[]).slice(0, 4).forEach((item, i) => expect(item).toBe(before.settings[i]));
    // Idempotent: once it's there (the learner's, or the demo's), nothing to do.
    expect(patchProps({ ...before, ...changed }, [patch])).toBeNull();
    expect(patchProps({ settings: [{ key: "Token", secret: true }] }, [patch])).toBeNull();
    // A list that isn't there is made; a value that isn't a list is left alone.
    expect(patchProps({}, [{ ...patch, with: { secret: false } }])).toEqual({
      settings: [{ key: "Token", secret: false }],
    });
    expect(patchProps({ settings: "Host=a" }, [patch])).toBeNull();
  });

  it("sets a nested value, copying only along its path", () => {
    const before = { settings: settings(), retry: { attempts: 2, backoff: "exp" } };
    const changed = patchProps(before, [
      { op: "set", path: ["settings", 1, "secret"], value: true },
      { op: "set", path: ["retry", "attempts"], value: 3 },
    ])!;
    expect(changed.retry).toEqual({ attempts: 3, backoff: "exp" });
    const list = changed.settings as unknown[];
    expect(list[1]).toEqual({ key: "Port", secret: true });
    expect(list[0]).toBe(before.settings[0]);
    expect(before.settings[1]).toEqual({ key: "Port", secret: false });
    expect(
      patchProps({ ...before, ...changed }, [{ op: "set", path: ["settings", 1, "secret"], value: true }]),
    ).toBeNull();
  });

  it("never invents list items, writes through a non-object, or touches the prototype", () => {
    const before = { settings: settings(), name: "x" };
    for (const path of [
      ["settings", 9, "secret"],
      ["settings", { where: { key: "Missing" } }, "secret"],
      ["name", "deeper"],
      ["__proto__", "polluted"],
      ["settings", 0, "constructor"],
    ] as const)
      expect(patchProps(before, [{ op: "set", path, value: true }]), JSON.stringify(path)).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("setIfMissing keeps the learner's value, and fills in one that's missing", () => {
    const patch: PropPatch = { op: "setIfMissing", path: ["retry", "attempts"], value: 3 };
    expect(patchProps({ retry: { attempts: 1 } }, [patch])).toBeNull();
    expect(patchProps({ retry: { backoff: "exp" } }, [patch])).toEqual({ retry: { backoff: "exp", attempts: 3 } });
    expect(patchProps(undefined, [patch])).toEqual({ retry: { attempts: 3 } });
  });

  it("applies patches in order, as one change, with catalog messages resolved", () => {
    const changed = patchProps({ settings: settings() }, [
      { op: "ensureItem", path: ["settings"], match: { key: token } },
      { op: "set", path: ["settings", { where: { key: token } }, "secret"], value: true },
    ]);
    expect((changed!.settings as unknown[]).at(-1)).toEqual({ key: "Token", secret: true });
  });
});

describe("path prop checks", () => {
  const diagram = (props: Record<string, unknown>): DiagramFile => ({
    format: "diagrams/v1",
    title: "t",
    nodes: [
      { id: "a", stencil: "generic.service", label: "A", x: 0, y: 0 },
      { id: "b", stencil: "postgres", label: "B", x: 1, y: 0 },
    ],
    edges: [{ id: "ab", from: "a", to: "b", kind: "sync", props }],
  });
  const met = (check: Check, props: Record<string, unknown>) =>
    holds(check, { diagram: diagram(props), live: false, processed: () => 0 }, { api: "a", config: "b" });
  const length = (op: "=" | ">=" | "<=", value: number): Check => ({
    kind: "prop",
    edge: ["api", "config"],
    prop: ["settings"],
    measure: "length",
    op,
    value,
  });

  it("compares a list's length, and fails for what isn't a list", () => {
    expect(met(length(">=", 4), { settings: settings() })).toBe(true);
    expect(met(length(">=", 5), { settings: settings() })).toBe(false);
    expect(met(length("=", 0), { settings: [] })).toBe(true);
    expect(met(length("<=", 9), {})).toBe(false);
    expect(met(length("<=", 9), { settings: "a,b" })).toBe(false);
  });

  it("compares a nested value with the usual operators", () => {
    const secret: Check = {
      kind: "prop",
      edge: ["api", "config"],
      prop: ["settings", 4, "secret"],
      op: "=",
      value: true,
    };
    expect(met(secret, { settings: settings() })).toBe(false);
    expect(met(secret, { settings: [...settings(), { key: "Token", secret: true }] })).toBe(true);
    const port: Check = {
      kind: "prop",
      edge: ["api", "config"],
      prop: ["settings", 1],
      op: "=",
      value: { key: "Port", secret: false },
    };
    expect(met(port, { settings: settings() })).toBe(true);
    // A top-level key still reads only the props' own keys.
    expect(met({ kind: "prop", edge: ["api", "config"], prop: "constructor", op: "=", value: Object }, {})).toBe(false);
  });
});
