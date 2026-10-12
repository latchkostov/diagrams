import { LIMITS, tooLargeMessage } from "../native";

// Google Drive REST v3, the few calls we need, with an injected `fetch` and token source so the
// logic is unit-testable without Google. Scope: drive.file (only files the user picked with the
// Picker or that this app created). Docs: https://developers.google.com/workspace/drive/api/guides/manage-uploads

export interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
}

export interface DriveDownload extends DriveFile {
  text: string;
}

export interface DriveClientDeps {
  fetch: typeof fetch;
  /** Returns a valid access token; `force` asks for a fresh one (after a 401). */
  getToken: (force?: boolean) => Promise<string>;
  /** Multipart boundary (tests pin it). */
  boundary?: () => string;
}

export class DriveError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

const API = "https://www.googleapis.com/drive/v3/files";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";
const FIELDS = "id,name,mimeType,webViewLink,size";

/** Builds a multipart/related body: JSON metadata part + content part. */
export function multipartBody(metadata: object, content: string, contentType: string, boundary: string): string {
  return [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${contentType}`,
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function friendly(status: number, body: string, action: string): string {
  let reason = "";
  try {
    reason = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? "";
  } catch {
    /* not JSON */
  }
  if (status === 401) return `Google Drive sign-in expired while trying to ${action}. Please try again.`;
  if (status === 403 && /storage|quota/i.test(reason))
    return "Your Google Drive is full, so the file couldn't be saved.";
  if (status === 403)
    return `Google Drive refused to ${action}. Diagrams can only open files you pick with it or that it created.${reason ? ` (${reason})` : ""}`;
  if (status === 404) return "That Google Drive file no longer exists, or Diagrams no longer has access to it.";
  if (status === 429 || status >= 500) return `Google Drive is busy right now (${status}). Try again in a moment.`;
  return `Couldn't ${action} on Google Drive (${status}${reason ? `: ${reason}` : ""}).`;
}

export function createDriveClient(deps: DriveClientDeps) {
  const boundary = deps.boundary ?? (() => `diagrams-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);

  /** Authorised fetch; retries once with a fresh token on 401. */
  async function call(url: string, init: RequestInit, action: string): Promise<Response> {
    let token = await deps.getToken();
    for (let attempt = 0; ; attempt++) {
      // A cancelled write stops here, after the token (which may have meant a sign-in) and before the upload.
      init.signal?.throwIfAborted();
      let res: Response;
      try {
        res = await deps.fetch(url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` },
        });
      } catch (err) {
        if (init.signal?.aborted) throw init.signal.reason ?? err;
        throw new DriveError(`Couldn't reach Google Drive to ${action}. Check your connection.`);
      }
      if (res.ok) return res;
      if (res.status === 401 && attempt === 0) {
        token = await deps.getToken(true);
        continue;
      }
      throw new DriveError(friendly(res.status, await res.text().catch(() => ""), action), res.status);
    }
  }

  return {
    async getMeta(id: string): Promise<DriveFile> {
      const res = await call(
        `${API}/${encodeURIComponent(id)}?fields=${FIELDS}&supportsAllDrives=true`,
        { method: "GET" },
        "read the file details",
      );
      return (await res.json()) as DriveFile;
    },

    async download(id: string): Promise<DriveDownload> {
      const meta = await this.getMeta(id);
      if (Number(meta.size) > LIMITS.maxTextChars) throw new DriveError(tooLargeMessage(Number(meta.size)));
      const res = await call(
        `${API}/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`,
        { method: "GET" },
        "download the file",
      );
      const size = Number(res.headers.get("Content-Length"));
      if (size > LIMITS.maxTextChars) {
        await res.body?.cancel();
        throw new DriveError(tooLargeMessage(size));
      }
      if (!res.body) return { ...meta, text: "" };
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let total = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > LIMITS.maxTextChars) {
            await reader.cancel();
            throw new DriveError(tooLargeMessage(total));
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
      } finally {
        reader.releaseLock();
      }
      return { ...meta, text: chunks.join("") };
    },

    /** Creates a file (in `parents` or My Drive root). */
    async create(
      file: { name: string; mimeType: string; content: string; parents?: string[] },
      signal?: AbortSignal,
    ): Promise<DriveFile> {
      const b = boundary();
      const meta = { name: file.name, mimeType: file.mimeType, ...(file.parents ? { parents: file.parents } : {}) };
      const res = await call(
        `${UPLOAD}?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`,
        {
          method: "POST",
          headers: { "Content-Type": `multipart/related; boundary=${b}` },
          body: multipartBody(meta, file.content, file.mimeType, b),
          signal,
        },
        "save the file",
      );
      return (await res.json()) as DriveFile;
    },

    /** Replaces the content (and optionally the name) of an existing file. */
    async update(
      id: string,
      file: { content: string; mimeType: string; name?: string },
      signal?: AbortSignal,
    ): Promise<DriveFile> {
      const b = boundary();
      const meta = file.name ? { name: file.name } : {};
      const res = await call(
        `${UPLOAD}/${encodeURIComponent(id)}?uploadType=multipart&fields=${FIELDS}&supportsAllDrives=true`,
        {
          method: "PATCH",
          headers: { "Content-Type": `multipart/related; boundary=${b}` },
          body: multipartBody(meta, file.content, file.mimeType, b),
          signal,
        },
        "update the file",
      );
      return (await res.json()) as DriveFile;
    },
  };
}

export type DriveClient = ReturnType<typeof createDriveClient>;
