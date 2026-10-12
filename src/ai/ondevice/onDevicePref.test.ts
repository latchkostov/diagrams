import { afterEach, describe, expect, it, vi } from "vitest";
import { ON_DEVICE_DEFAULT, readOnDevice, rememberOnDevice } from "./onDevicePref";

describe("Try the on-device model", () => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
  });
  afterEach(() => store.clear());

  it("is off by default until the evals clear the bar, then remembered", () => {
    expect(ON_DEVICE_DEFAULT).toBe(false);
    expect(readOnDevice()).toBe(false);
    rememberOnDevice(true);
    expect(readOnDevice()).toBe(true);
    rememberOnDevice(false);
    expect(readOnDevice()).toBe(false);
  });
});
