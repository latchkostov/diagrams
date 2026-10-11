import { describe, expect, it } from "vitest";
import { readDriveConfig } from "../gdrive/config";
import { readDropboxConfig, readOneDriveConfig } from "./config";
import { CLOUD_PROVIDERS, cloudProviders, DEVICE, PROVIDERS, providerInfo } from "./registry";

const none = { gdrive: false, onedrive: false, dropbox: false, test: false };

describe("env gating", () => {
  it("with no variables, nothing is configured and nothing throws", () => {
    expect(readDriveConfig({})).toBeUndefined();
    expect(readOneDriveConfig({})).toBeUndefined();
    expect(readDropboxConfig({})).toBeUndefined();
    expect(readOneDriveConfig({ VITE_ONEDRIVE_CLIENT_ID: "  " })).toBeUndefined();
    expect(readDropboxConfig({ VITE_DROPBOX_APP_KEY: "" })).toBeUndefined();
  });

  it("hides a provider whose value is malformed rather than failing at sign-in", () => {
    expect(readOneDriveConfig({ VITE_ONEDRIVE_CLIENT_ID: "not-a-guid" })).toBeUndefined();
    expect(readDropboxConfig({ VITE_DROPBOX_APP_KEY: "has spaces" })).toBeUndefined();
  });

  it("reads OneDrive (common tenant by default) and Dropbox", () => {
    expect(readOneDriveConfig({ VITE_ONEDRIVE_CLIENT_ID: " 11111111-2222-3333-4444-555555555555 " })).toEqual({
      clientId: "11111111-2222-3333-4444-555555555555",
      tenant: "common",
    });
    expect(
      readOneDriveConfig({
        VITE_ONEDRIVE_CLIENT_ID: "11111111-2222-3333-4444-555555555555",
        VITE_ONEDRIVE_TENANT: "consumers",
      })?.tenant,
    ).toBe("consumers");
    expect(readDropboxConfig({ VITE_DROPBOX_APP_KEY: "abc123xyz" })).toEqual({ appKey: "abc123xyz" });
  });

  it("this test build has no cloud provider: only the device is offered", () => {
    expect(CLOUD_PROVIDERS).toEqual([]);
    expect(PROVIDERS).toEqual([DEVICE]);
    expect(providerInfo("onedrive")).toBeUndefined();
    expect(providerInfo("device")).toBe(DEVICE);
  });
});

describe("the registry", () => {
  it("lists configured providers in menu order, each with one name", () => {
    expect(cloudProviders(none)).toEqual([]);
    const all = cloudProviders({ gdrive: true, onedrive: true, dropbox: true, test: false });
    expect(all.map((p) => [p.id, p.label])).toEqual([
      ["gdrive", "Google Drive"],
      ["onedrive", "OneDrive"],
      ["dropbox", "Dropbox"],
    ]);
    expect(cloudProviders({ ...none, dropbox: true }).map((p) => p.id)).toEqual(["dropbox"]);
    expect(DEVICE.inSentence).toBe("this device");
  });

  it("offers the fake test provider only when asked for (dev builds only)", () => {
    expect(cloudProviders({ ...none, test: true }).map((p) => p.id)).toEqual(import.meta.env.DEV ? ["test"] : []);
  });

  it("loads provider code only when asked", async () => {
    const [onedrive] = cloudProviders({ ...none, onedrive: true });
    const provider = await onedrive.load();
    expect(provider.id).toBe("onedrive");
    // This build has no VITE_ONEDRIVE_CLIENT_ID, so even the loaded provider says it isn't configured.
    expect(provider.isConfigured()).toBe(false);
    expect(await onedrive.load()).toBe(provider);
  });
});
