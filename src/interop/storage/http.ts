import { t } from "../../i18n";
import { LIMITS, tooLargeMessage } from "../native";
import { StorageError } from "./types";

// Small HTTP helpers shared by the cloud providers' REST clients (each takes an injected `fetch` and
// token source, so the clients are unit-tested against a fake fetch).

export interface ClientDeps {
  fetch: typeof fetch;
  /** A valid access token; `force` asks for a fresh one (after a 401). */
  getToken: (force?: boolean) => Promise<string>;
}

/** Turns a failed response into the provider's readable message. */
export type ErrorMapper = (status: number, body: string, action: string) => string;

/** Authorised fetch: Bearer token, one retry with a fresh token on 401, readable errors. */
export async function authorized(
  deps: ClientDeps,
  label: string,
  mapError: ErrorMapper,
  url: string,
  init: RequestInit,
  action: string,
): Promise<Response> {
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
      throw new StorageError(
        t("cloud.couldntReachLabelToActionCheckYour", { label: label, action: action.replaceAll(" ", "_") }),
      );
    }
    if (res.ok) return res;
    if (res.status === 401 && attempt === 0) {
      token = await deps.getToken(true);
      continue;
    }
    throw new StorageError(mapError(res.status, await res.text().catch(() => ""), action), res.status);
  }
}

/** Reads a response body as text, stopping (and failing) as soon as it passes the import budget. */
export async function readTextCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("Content-Length"));
  if (declared > LIMITS.maxTextChars) {
    await res.body?.cancel();
    throw new StorageError(tooLargeMessage(declared));
  }
  if (!res.body) return "";
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
        throw new StorageError(tooLargeMessage(total));
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
  return chunks.join("");
}

/** Fails early when a listed size is already over the import budget. */
export function checkSize(size: unknown): void {
  const n = Number(size);
  if (n > LIMITS.maxTextChars) throw new StorageError(tooLargeMessage(n));
}

/** JSON that is safe in an HTTP header: everything outside printable ASCII becomes a JSON escape. */
export function headerSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/** Picks a field from a JSON error body without trusting its shape. */
export function jsonField(body: string, pick: (j: Record<string, unknown>) => unknown): string {
  try {
    const v = pick(JSON.parse(body) as Record<string, unknown>);
    return typeof v === "string" ? v : "";
  } catch {
    return "";
  }
}
