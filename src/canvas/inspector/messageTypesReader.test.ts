import { afterEach, expect, it, vi } from "vitest";
import { messageTypesFixture } from "../../lab/messageTypesFixture";
import * as analysis from "../../model/messageTypes";
import { createMessageTypesReader } from "./messageTypesReader";
import type { DiagramFile } from "../../model/types";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("queues propagation after edits settle, keeps its previous result, and suspends during naming", async () => {
  vi.useFakeTimers();
  const compute = vi.spyOn(analysis, "cachedMessageTypesAt");
  const reader = createMessageTypesReader();
  const d = messageTypesFixture();
  reader.update(d);
  expect(compute).not.toHaveBeenCalled();
  expect(reader.get()).toBeUndefined();
  await vi.runAllTimersAsync();
  expect(compute).toHaveBeenCalledOnce();
  const first = reader.get();
  expect(first?.carried.get("send")).toContain("Callback");
  // Unrelated edits never enter propagation, even after the idle queue drains.
  let edited: DiagramFile = {
    ...d,
    nodes: d.nodes.map((n) => ({
      ...n,
      label: n.id === "api" ? `${n.label}x` : n.label,
      props: { ...n.props, latencyMs: 900 },
    })),
  };
  reader.update(edited);
  await vi.runAllTimersAsync();
  expect(compute).toHaveBeenCalledOnce();
  expect(reader.get()).toBe(first);
  // Several forwarding edits coalesce into one analysis, cancelled while a name field is active.
  for (let i = 0; i < 8; i++) {
    edited = {
      ...edited,
      nodes: edited.nodes.map((n) => (n.id === "api" ? { ...n, props: { emits: `Type${i}` } } : n)),
    };
    reader.update(edited);
    expect(reader.get()).toBe(first);
    expect(compute).toHaveBeenCalledOnce();
  }
  reader.update(edited, true);
  await vi.runAllTimersAsync();
  expect(compute).toHaveBeenCalledOnce();
  reader.update(edited);
  expect(reader.get()).toBe(first);
  await vi.runAllTimersAsync();
  expect(compute).toHaveBeenCalledTimes(2);
  expect(reader.get()?.carried.get("send")).toEqual(new Set(["Type7"]));
  reader.update(d);
  reader.cancel();
  await vi.runAllTimersAsync();
  expect(compute).toHaveBeenCalledTimes(2);
});
