// Local files: the File System Access API where available (Chrome / Edge: real "Save" back to the
// same file, which also works inside a Google Drive for desktop or OneDrive synced folder), with
// download + <input type=file> fallbacks for Firefox and Safari.

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
interface FsHandle {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(o: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}
type FsWindow = Window & {
  showOpenFilePicker?: (o: {
    types?: PickerType[];
    excludeAcceptAllOption?: boolean;
    multiple?: boolean;
    id?: string;
  }) => Promise<FsHandle[]>;
  showSaveFilePicker?: (o: { suggestedName?: string; types?: PickerType[]; id?: string }) => Promise<FsHandle>;
};

export type FileHandle = FsHandle;

const w = () => window as FsWindow;

/** True when we can open and save real files (not in cross-origin iframes, where the API is blocked). */
export function fsAccessSupported(): boolean {
  try {
    return (
      typeof w().showOpenFilePicker === "function" &&
      typeof w().showSaveFilePicker === "function" &&
      window.self === window.top
    );
  } catch {
    return false;
  }
}

export const NATIVE_TYPE: PickerType = { description: "Diagrams file", accept: { "application/json": [".json"] } };
const OPEN_TYPES: PickerType[] = [
  {
    description: "Diagrams, draw.io and Mermaid files",
    accept: {
      "application/json": [".json"],
      "application/xml": [".drawio", ".xml", ".svg"],
      "text/plain": [".mmd", ".mermaid"],
    },
  },
];

const isAbort = (err: unknown) =>
  err instanceof DOMException && (err.name === "AbortError" || err.name === "NotAllowedError");

/** Opens a file with the system picker. Undefined if the user cancelled. */
export async function openWithPicker(): Promise<{ file: File; handle: FileHandle } | undefined> {
  try {
    const [handle] = await w().showOpenFilePicker!({ types: OPEN_TYPES, id: "diagrams" });
    return { file: await handle.getFile(), handle };
  } catch (err) {
    if (isAbort(err)) return undefined;
    throw err;
  }
}

/** Asks where to save, writes the text, returns the handle. Undefined if cancelled. */
export async function saveWithPicker(
  text: string,
  suggestedName: string,
  type: PickerType = NATIVE_TYPE,
): Promise<FileHandle | undefined> {
  let handle: FileHandle;
  try {
    handle = await w().showSaveFilePicker!({ suggestedName, types: [type], id: "diagrams" });
  } catch (err) {
    if (isAbort(err)) return undefined;
    throw err;
  }
  await writeHandle(handle, text);
  return handle;
}

/** Writes to a handle we already have (asks for permission again after a reload of the tab). */
export async function writeHandle(handle: FileHandle, text: string): Promise<void> {
  if (handle.queryPermission && (await handle.queryPermission({ mode: "readwrite" })) !== "granted") {
    if ((await handle.requestPermission?.({ mode: "readwrite" })) !== "granted")
      throw new Error(`Permission to save “${handle.name}” wasn't granted.`);
  }
  const out = await handle.createWritable();
  await out.write(text);
  await out.close();
}

export function downloadBlob(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1500);
}

export const downloadText = (text: string, name: string, mime: string) =>
  downloadBlob(new Blob([text], { type: mime }), name);

/**
 * A data: URL's bytes as a Blob, decoded here rather than with fetch(), which the Content-Security-Policy's
 * connect-src (this site and the storage providers only) doesn't allow for data: URLs.
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error("Not a data: URL.");
  const [, type, base64, payload] = m;
  if (!base64) return new Blob([decodeURIComponent(payload)], { type: type || "text/plain" });
  const bin = atob(payload);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

export async function downloadDataUrl(dataUrl: string, name: string): Promise<void> {
  downloadBlob(dataUrlToBlob(dataUrl), name);
}

/** "Kafka order pipeline" -> "kafka-order-pipeline". */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "diagram";
