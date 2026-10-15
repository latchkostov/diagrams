import { createHash } from "node:crypto";

/** SHA-256 of text or bytes, hex. */
export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** A short, readable fingerprint of a large output: its hash and size. */
export function fingerprint(data: string | Uint8Array): { sha256: string; bytes: number } {
  const bytes = typeof data === "string" ? Buffer.byteLength(data, "utf8") : data.byteLength;
  return { sha256: sha256(data), bytes };
}
