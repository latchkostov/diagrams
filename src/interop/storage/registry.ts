import type { GlyphName } from "../ui/glyphs";
import { driveEnabled } from "../gdrive/config";
import { dropboxConfig, oneDriveConfig } from "./config";
import type { ProviderId, StorageProvider } from "./types";
import { deviceProvider } from "./device";

// Which storage providers this build offers. This module is in the main bundle, so it only holds
// names, icons and env flags. Each cloud provider's code is a separate chunk, loaded the first time
// it's used (or when the File menu opens, so a click can open its sign-in popup straight away), and
// only when that provider is configured. With nothing configured, no provider code ever loads.

export interface ProviderInfo {
  id: ProviderId;
  /** One name everywhere (menus, toasts, status, docs). */
  label: string;
  /** The label mid-sentence ("Saved to this device"). */
  inSentence: string;
  icon: GlyphName;
  load(): Promise<StorageProvider>;
}

export interface ProviderFlags {
  gdrive: boolean;
  onedrive: boolean;
  dropbox: boolean;
  /** The dev-only fake provider (`?storage=test`); never true in a production build. */
  test: boolean;
}

const once = <T>(fn: () => Promise<T>) => {
  let p: Promise<T> | undefined;
  return () => {
    p ??= fn();
    p.catch(() => (p = undefined));
    return p;
  };
};

export const DEVICE: ProviderInfo = {
  id: "device",
  label: "This device",
  inSentence: "this device",
  icon: "device",
  // Static: the system file picker needs the click it was opened from, with nothing to load first.
  load: () => Promise.resolve(deviceProvider as StorageProvider),
};

const CLOUD: (ProviderInfo & { flag: keyof ProviderFlags })[] = [
  {
    flag: "gdrive",
    id: "gdrive",
    label: "Google Drive",
    inSentence: "Google Drive",
    icon: "drive",
    load: once(() => import("./gdrive").then((m) => m.gdriveProvider as StorageProvider)),
  },
  {
    flag: "onedrive",
    id: "onedrive",
    label: "OneDrive",
    inSentence: "OneDrive",
    icon: "onedrive",
    load: once(() => import("./onedrive").then((m) => m.oneDriveProvider() as StorageProvider)),
  },
  {
    flag: "dropbox",
    id: "dropbox",
    label: "Dropbox",
    inSentence: "Dropbox",
    icon: "dropbox",
    load: once(() => import("./dropbox").then((m) => m.dropboxProvider() as StorageProvider)),
  },
  // Statically false in production builds, so the bundler drops this entry and its chunk.
  ...(import.meta.env.DEV
    ? [
        {
          flag: "test" as const,
          id: "test" as const,
          label: "Test storage",
          inSentence: "Test storage",
          icon: "stack" as const,
          load: once(() => import("./testProvider").then((m) => m.testProvider as StorageProvider)),
        },
      ]
    : []),
];

/** The configured cloud providers, in menu order. Pure, for tests. */
export function cloudProviders(flags: ProviderFlags): ProviderInfo[] {
  return CLOUD.filter((p) => flags[p.flag]);
}

const testRequested = () => {
  try {
    return new URLSearchParams(window.location.search).get("storage") === "test";
  } catch {
    return false;
  }
};

/** Read once at startup: the build's env, plus the dev-only test flag. */
export const CLOUD_PROVIDERS: ProviderInfo[] = cloudProviders({
  gdrive: driveEnabled,
  onedrive: !!oneDriveConfig,
  dropbox: !!dropboxConfig,
  test: import.meta.env.DEV && typeof window !== "undefined" && testRequested(),
});

/** Device first, then the configured cloud providers. */
export const PROVIDERS: ProviderInfo[] = [DEVICE, ...CLOUD_PROVIDERS];

/** A provider this build offers, or undefined (e.g. a saved OneDrive file in a build without OneDrive). */
export const providerInfo = (id: string | undefined): ProviderInfo | undefined => PROVIDERS.find((p) => p.id === id);
