import { createReadStream } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { validateHeaderName, validateHeaderValue, type IncomingMessage, type ServerResponse } from "node:http";
import { pipeline } from "node:stream/promises";
import { createBrotliCompress, createGzip } from "node:zlib";

interface HeaderManifest {
  version: number;
  app: Record<string, string>;
  embed: Record<string, string>;
  script: Record<string, string>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".webmanifest": "application/manifest+json",
  ".zip": "application/zip",
  ".pdf": "application/pdf",
  ".map": "application/json; charset=utf-8",
};

function manifest(raw: string): HeaderManifest {
  const value = JSON.parse(raw) as HeaderManifest;
  if (value.version !== 1) throw new Error("Invalid static header manifest");
  for (const policy of [value.app, value.embed, value.script]) {
    if (!policy || typeof policy !== "object" || Array.isArray(policy)) throw new Error("Invalid static headers");
    for (const [key, content] of Object.entries(policy)) {
      if (typeof content !== "string") throw new Error("Invalid static header value");
      validateHeaderName(key);
      validateHeaderValue(key, content);
    }
  }
  if (!value.app["Content-Security-Policy"] || !value.embed["Content-Security-Policy"])
    throw new Error("Missing static security policy");
  return value;
}

/** Match nginx's raw query parameter policy, before URL normalisation can erase traversal attempts. */
export function requestPath(url: string): string | undefined {
  try {
    const path = decodeURIComponent(url.split("?")[0]);
    if (
      !path.startsWith("/") ||
      path.includes("//") ||
      /[\\:]/.test(path) ||
      [...path].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      path.split("/").some((s) => s.startsWith(".") || /[. ]$/.test(s))
    )
      return;
    return path;
  } catch {
    return;
  }
}

/** Accept-Encoding quality values; identity is permitted unless explicitly excluded. */
function encoding(header = "", compressible = true): "br" | "gzip" | "identity" | undefined {
  const quality = new Map(
    header
      .toLowerCase()
      .split(",")
      .filter(Boolean)
      .map((part) => {
        const [name, ...params] = part.trim().split(";");
        const q = params
          .find((p) => p.trim().startsWith("q="))
          ?.trim()
          .slice(2);
        const n = q === undefined ? 1 : Number(q);
        return [name, Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0] as const;
      }),
  );
  const choices = ["br", "gzip", "identity"] as const;
  return choices
    .map((name) => ({
      name,
      q: quality.get(name) ?? (name === "identity" ? (quality.get("*") === 0 ? 0 : 1) : (quality.get("*") ?? 0)),
    }))
    .filter((c) => c.q > 0 && (compressible || c.name === "identity"))
    .sort((a, b) => b.q - a.q)[0]?.name;
}

export async function createStaticHandler(directory: string, base: string) {
  const root = await realpath(resolve(directory));
  const headers = manifest(await readFile(resolve(root, "headers.json"), "utf8"));
  const inside = (file: string) => {
    const path = relative(root, file);
    return path !== ".." && !path.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(path);
  };
  const find = async (name: string) => {
    try {
      const file = await realpath(resolve(root, name));
      if (!inside(file)) return;
      const info = await stat(file);
      if (info.isFile()) return { file, info };
      if (info.isDirectory()) {
        const index = await realpath(resolve(file, "index.html"));
        if (inside(index)) {
          const info = await stat(index);
          if (info.isFile()) return { file: index, info };
        }
      }
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  };
  if (!(await find("index.html"))) throw new Error("Static index.html is missing");
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? "/";
    const path = requestPath(url);
    const policy = { ...(/(?:\?|&)embed(?:=|&|$)/.test(url) ? headers.embed : headers.app) };
    if (path?.endsWith("/auth.html")) delete policy["Cross-Origin-Opener-Policy"];
    const script = /\/embed\/[^/]+\.js$/.test(path ?? "");
    if (script) Object.assign(policy, headers.script);
    for (const [key, value] of Object.entries(policy)) res.setHeader(key, value);
    const fail = (status: number) => res.writeHead(status, { "Cache-Control": "no-store" }).end();
    if (!path) {
      fail(400);
      return;
    }
    if (base !== "/" && path === base.slice(0, -1)) {
      res.writeHead(308, { Location: `${base}${url.includes("?") ? url.slice(url.indexOf("?")) : ""}` }).end();
      return;
    }
    if (!path.startsWith(base)) {
      fail(404);
      return;
    }
    const name = path.slice(base.length);
    if (name.split("/").some((s) => s.toLowerCase() === "headers.json")) {
      fail(404);
      return;
    }
    let found = await find(name || "index.html");
    // Missing resources are never replaced with HTML. No directory listing.
    if (
      !found &&
      !name.startsWith("assets/") &&
      !name.startsWith("embed/") &&
      !extname(name) &&
      !(await stat(resolve(root, name)).catch(() => undefined))
    )
      found = await find("index.html");
    if (!found) {
      fail(404);
      return;
    }
    const mime = MIME[extname(found.file).toLowerCase()] ?? "application/octet-stream";
    const selected = encoding(
      req.headers["accept-encoding"],
      /^(text\/|application\/(javascript|json|wasm|xml)|image\/svg)/.test(mime),
    );
    if (!selected) {
      fail(406);
      return;
    }
    const compress = selected !== "identity";
    res.setHeader("Content-Type", mime);
    res.setHeader(
      "Cache-Control",
      mime.startsWith("text/html")
        ? "no-cache"
        : script
          ? headers.script["Cache-Control"]
          : name.startsWith("assets/")
            ? "public, max-age=31536000, immutable"
            : "no-cache",
    );
    res.setHeader("Vary", "Accept-Encoding");
    if (compress) res.setHeader("Content-Encoding", selected);
    else res.setHeader("Content-Length", found.info.size);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = createReadStream(found.file);
    if (compress) await pipeline(stream, selected === "br" ? createBrotliCompress() : createGzip(), res);
    else await pipeline(stream, res);
  };
}
