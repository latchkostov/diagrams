// Build-time configuration for the optional cloud providers. Every one is optional: with no
// variables set (the default, and production today) the app is fully usable, every cloud entry is
// hidden, and no provider code, script or request is ever loaded. Nothing here throws.
//
// Values are public by design (OAuth client ids / app keys for PKCE public clients; no secrets).

type Env = Record<string, string | boolean | undefined>;

const value = (env: Env, name: string) => (typeof env[name] === "string" ? (env[name] as string).trim() : "");

export interface OneDriveConfig {
  /** Entra ID "Application (client) ID" of a single-page-application registration. */
  clientId: string;
  /** `common` (personal and work or school accounts), `consumers`, `organizations` or a tenant id. */
  tenant: string;
}

export interface DropboxConfig {
  /** The app key from the Dropbox App Console (an App folder app with PKCE). */
  appKey: string;
}

/** Entra client ids are GUIDs; anything else is a typo we'd rather hide than fail on at sign-in. */
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readOneDriveConfig(env: Env = import.meta.env): OneDriveConfig | undefined {
  const clientId = value(env, "VITE_ONEDRIVE_CLIENT_ID");
  if (!GUID.test(clientId)) return undefined;
  const tenant = value(env, "VITE_ONEDRIVE_TENANT") || "common";
  return { clientId, tenant: /^[a-z0-9.-]+$/i.test(tenant) ? tenant : "common" };
}

export function readDropboxConfig(env: Env = import.meta.env): DropboxConfig | undefined {
  const appKey = value(env, "VITE_DROPBOX_APP_KEY");
  return /^[a-z0-9]{5,40}$/i.test(appKey) ? { appKey } : undefined;
}

export const oneDriveConfig = readOneDriveConfig();
export const dropboxConfig = readDropboxConfig();
