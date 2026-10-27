import { expect, it, vi } from "vitest";
import { registerFrameCapture, suspendFrameCapture } from "./frameCapture";
it("suspends and restores identity and frame decoration together", () => {
  const viewport = {} as Element;
  const identity = vi.fn();
  const frame = vi.fn();
  const suspendIdentity = vi.fn(() => identity);
  const suspendFrame = vi.fn(() => frame);
  const unregisterIdentity = registerFrameCapture(viewport, suspendIdentity);
  const unregisterFrame = registerFrameCapture(viewport, suspendFrame);
  const release = suspendFrameCapture(viewport);
  expect(suspendIdentity).toHaveBeenCalledOnce();
  expect(suspendFrame).toHaveBeenCalledOnce();
  release();
  expect(identity).toHaveBeenCalledOnce();
  expect(frame).toHaveBeenCalledOnce();
  unregisterIdentity();
  unregisterFrame();
});
it("suspends detail that mounts during capture and resumes only after the last capture", () => {
  const viewport = {} as Element;
  const first = suspendFrameCapture(viewport);
  const resume = vi.fn();
  const suspend = vi.fn(() => resume);
  const unregister = registerFrameCapture(viewport, suspend);
  expect(suspend).toHaveBeenCalledOnce();
  const second = suspendFrameCapture(viewport);
  first();
  first();
  expect(resume).not.toHaveBeenCalled();
  second();
  expect(resume).toHaveBeenCalledOnce();
  unregister();
});
it("unregistering a suspended surface never reapplies its mutations", () => {
  const viewport = {} as Element;
  const resume = vi.fn();
  const unregister = registerFrameCapture(viewport, () => resume);
  const release = suspendFrameCapture(viewport);
  unregister();
  release();
  expect(resume).toHaveBeenCalledOnce();
});
it("captures natural identity size even before any canvas surface has registered", () => {
  // The frame-detail chunk may still be loading (or have failed): nothing registered, yet the image
  // must not inherit the on-screen zoom that counter-scales titles and icons.
  const props = new Map<string, string>();
  const style = {
    getPropertyValue: (name: string) => props.get(name) ?? "",
    setProperty: (name: string, value: string) => void props.set(name, value),
    removeProperty: (name: string) => void props.delete(name),
  };
  const viewport = { style } as unknown as Element;
  const first = suspendFrameCapture(viewport);
  expect(props.get("--rf-zoom-exact")).toBe("1");
  const nested = suspendFrameCapture(viewport);
  nested();
  expect(props.get("--rf-zoom-exact")).toBe("1");
  first();
  expect(props.has("--rf-zoom-exact")).toBe(false);
  props.set("--rf-zoom-exact", "0.24");
  const again = suspendFrameCapture(viewport);
  expect(props.get("--rf-zoom-exact")).toBe("1");
  again();
  expect(props.get("--rf-zoom-exact")).toBe("0.24");
});
