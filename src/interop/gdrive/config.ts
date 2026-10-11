// Google Drive is opt-in at build time: without a client id and API key (see .env.example and
// docs/INTEROP.md) every Drive menu item is hidden and no Google script is ever loaded.

export interface DriveConfig {
  clientId: string;
  apiKey: string;
  /** Cloud project *number* (the Picker's setAppId, needed for drive.file). Defaults to the client id prefix. */
  appId: string;
}

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const NATIVE_MIME = "application/json";
/** What the Picker shows: our JSON files, draw.io files and Mermaid text. */
export const PICKER_MIME_TYPES = [
  "application/json",
  "application/vnd.jgraph.mxfile",
  "application/xml",
  "text/xml",
  "text/plain",
  "image/svg+xml",
].join(",");

export function readDriveConfig(
  env: Record<string, string | boolean | undefined> = import.meta.env,
): DriveConfig | undefined {
  const clientId = typeof env.VITE_GOOGLE_CLIENT_ID === "string" ? env.VITE_GOOGLE_CLIENT_ID.trim() : "";
  const apiKey = typeof env.VITE_GOOGLE_API_KEY === "string" ? env.VITE_GOOGLE_API_KEY.trim() : "";
  if (!clientId || !apiKey) return undefined;
  const explicit = typeof env.VITE_GOOGLE_APP_ID === "string" ? env.VITE_GOOGLE_APP_ID.trim() : "";
  const appId = explicit || /^(\d+)-/.exec(clientId)?.[1] || "";
  return { clientId, apiKey, appId };
}

export const driveConfig = readDriveConfig();
export const driveEnabled = !!driveConfig;
