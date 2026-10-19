import { once } from "node:events";
import { createConnection } from "node:net";
import { request } from "node:http";
import type { ServerResponse } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { selfHostHeaderManifest } from "../../../scripts/self-host-headers";
import { nginxServer } from "../../../scripts/self-host-templates";
import { verifyInstance } from "../../../scripts/self-host-verify";
import { FakeClock } from "../../../src/collab/clock";
import { COLLAB_LIMITS } from "../../../src/collab/limits";
import { CompressionCache } from "../src/compression";
import {
  RELAY_CLOSE,
  RELAY_LIMITS,
  RELAY_SUBPROTOCOL,
  clientFrame,
  readServerFrame,
  parseControl,
} from "../../../src/collab/transport/relayProtocol";
import { createRelayServer } from "../src/http";
import { readConfig } from "../src/config";
import { barrier, connect, startServer, rejectUpgrade } from "./harness";

const room = "A".repeat(43);
const frameAncestors = ["https://wiki.example.com"];

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "ld-hosting-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const files = {
    "index.html":
      '<!doctype html><html><head><title>App</title><script type="module" src="./assets/app-AbCd1234.js"></script><link rel="stylesheet" href="./assets/style-AbCd1234.css"></head><body></body></html>',
    "auth.html": "<!doctype html><title>Auth</title>",
    "assets/app-AbCd1234.js": "export const app = true;",
    "assets/style-AbCd1234.css": "body { color: black; }",
    "embed/live-diagram.js": "export const embed = true;",
    "icon.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
    "font.woff2": "font",
    "skill/index.html": '<!doctype html><script src="copy.js"></script><a href="SKILL.md">Skill</a>',
    "skill/copy.js": "export const copy = true;",
    "skill/SKILL.md": "Skill documentation",
    "headers.json": JSON.stringify(selfHostHeaderManifest({ frameAncestors })),
  };
  for (const [name, text] of Object.entries(files)) {
    await mkdir(join(root, name, ".."), { recursive: true });
    await writeFile(join(root, name), text);
  }
  await mkdir(join(root, "empty"));
  return { root, files };
}

function get(origin: string, path: string, headers: Record<string, string> = {}, method = "GET") {
  return new Promise<{ status: number; headers: import("node:http").IncomingHttpHeaders; body: Buffer }>(
    (resolve, reject) => {
      const req = request(origin, { path, method, headers, agent: false }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end();
    },
  );
}

describe("static UI hosting", () => {
  it.each(["/", "/tools/diagrams/"])(
    "serves files, fallback, MIME, cache, HEAD and reserved routes at %s",
    async (base) => {
      const f = await fixture();
      const s = await startServer({ LD_STATIC: "on", LD_STATIC_DIR: f.root, LD_BASE: base });
      for (const suffix of ["", "index.html", "room/unknown?x=1"]) {
        const res = await get(s.origin, `${base}${suffix}`);
        expect(res.status).toBe(200);
        const html = res.body.toString();
        expect(html).toBe(
          f.files["index.html"].replace("<head>", `<head>\n    <base data-self-host="true" href="${base}">`),
        );
        const documentUrl = `${s.origin}${base}${suffix}`;
        const href = html.match(/<base[^>]+href="([^"]+)"/)?.[1];
        if (!href) throw new Error("Expected base element");
        const assetBase = new URL(href, documentUrl);
        for (const asset of html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)) {
          const loaded = await get(s.origin, new URL(asset[1], assetBase).pathname);
          expect(loaded.status).toBe(200);
          expect(loaded.headers["content-type"]).not.toContain("text/html");
        }
        expect(res.headers["content-type"]).toBe("text/html; charset=utf-8");
        expect(res.headers["cache-control"]).toBe("no-cache");
      }
      for (const [file, mime] of [
        ["assets/app-AbCd1234.js", "application/javascript"],
        ["assets/style-AbCd1234.css", "text/css"],
        ["icon.svg", "image/svg+xml"],
        ["font.woff2", "font/woff2"],
      ]) {
        const res = await get(s.origin, `${base}${file}`);
        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain(mime);
        expect(res.headers["cache-control"]).toBe(
          file.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-cache",
        );
      }
      const head = await get(s.origin, base, {}, "HEAD");
      expect(head.status).toBe(200);
      expect(head.body.length).toBe(0);
      expect(Number(head.headers["content-length"])).toBe((await get(s.origin, base)).body.length);
      expect((await get(s.origin, base, {}, "POST")).status).toBe(405);
      for (const suffix of [
        "assets/missing.js",
        "embed/missing.js",
        "missing.js",
        "empty/",
        "headers.json",
        "HEADERS.JSON",
      ])
        expect((await get(s.origin, `${base}${suffix}`)).status).toBe(404);
      for (const suffix of ["api/v1/rooms", "collab/v1", "api", "collab"])
        expect((await get(s.origin, `${base}${suffix}`)).status).toBe(501);
      if (base !== "/") {
        const redirect = await get(s.origin, `${base.slice(0, -1)}?embed=1`);
        expect(redirect.status).toBe(308);
        expect(redirect.headers.location).toBe(`${base}?embed=1`);
        expect((await get(s.origin, "/outside")).status).toBe(404);
      }
    },
  );

  it.each(["/", "/tools/diagrams/"])(
    "canonicalises directory indexes at %s, preserving query and relative links",
    async (base) => {
      const f = await fixture();
      const s = await startServer({ LD_STATIC: "on", LD_STATIC_DIR: f.root, LD_BASE: base });
      const response = await get(s.origin, `${base}skill?x=1&embed=1`);
      expect(response.status).toBe(308);
      expect(response.headers.location).toBe(`${base}skill/?x=1&embed=1`);
      const directoryUrl = new URL(response.headers.location ?? "", s.origin);
      const page = await get(s.origin, directoryUrl.pathname + directoryUrl.search);
      expect(page.body.toString()).toBe(f.files["skill/index.html"]);
      for (const file of ["copy.js", "SKILL.md"]) {
        const resource = await get(s.origin, new URL(file, directoryUrl).pathname);
        expect(resource.status).toBe(200);
        expect(resource.body.toString()).toBe(f.files[`skill/${file}` as keyof typeof f.files]);
      }
    },
  );

  it("selects the embed policy only for a parsed embed query parameter", async () => {
    const f = await fixture();
    const s = await startServer({ LD_STATIC: "on", LD_STATIC_DIR: f.root });
    const policies = selfHostHeaderManifest({ frameAncestors });
    for (const path of ["/?x=?embed=1", "/?x=%3Fembed=1", "/route&embed=1", "/route%3Fembed=1", "/?x=1%26embed=1"]) {
      const res = await get(s.origin, path);
      expect(res.status, path).toBe(200);
      expect(res.headers["content-security-policy"], path).toBe(policies.app["Content-Security-Policy"]);
    }
    for (const path of ["/?embed", "/?embed=1", "/?x=1&embed=0", "/?%65mbed=1"]) {
      expect((await get(s.origin, path)).headers["content-security-policy"], path).toBe(
        policies.embed["Content-Security-Policy"],
      );
    }
  });

  it("rejects raw and encoded traversal, Windows paths, dotfiles and symlink escapes", async () => {
    const f = await fixture();
    const outside = await mkdtemp(join(tmpdir(), "ld-outside-"));
    onTestFinished(() => rm(outside, { recursive: true, force: true }));
    await writeFile(join(outside, "secret.txt"), "outside-canary");
    // Directory junctions work on Windows without symlink privileges.
    await symlink(outside, join(f.root, "escape"), process.platform === "win32" ? "junction" : "dir");
    const s = await startServer({ LD_STATIC: "on", LD_STATIC_DIR: f.root });
    for (const path of [
      "/../secret.txt",
      "/%2e%2e/secret.txt",
      "/x/%2e%2e/secret.txt",
      "/..%5csecret.txt",
      "/%00",
      "/%zz",
      "/C:%5csecret.txt",
      "/.env",
      "/%2f../secret.txt",
      "/headers.json.",
      "/HEADERS.JSON%20",
      "///server/share",
      "/%2f%2fserver/share",
    ]) {
      const res = await get(s.origin, path);
      expect(res.status, path).toBe(400);
      expect(res.body.toString()).not.toContain("outside-canary");
    }
    expect((await get(s.origin, "/escape/secret.txt")).status).toBe(404);
    expect((await get(s.origin, "/escape/")).status).toBe(404);
  });

  it.each([
    ["br", brotliDecompressSync],
    ["gzip", gunzipSync],
  ] as const)("compresses with %s and respects negotiation", async (name, decompress) => {
    const f = await fixture();
    const s = await startServer({ LD_STATIC: "on", LD_STATIC_DIR: f.root });
    const res = await get(s.origin, "/", { "Accept-Encoding": name });
    expect(res.headers["content-encoding"]).toBe(name);
    expect(res.headers.vary).toBe("Accept-Encoding");
    const expected = (await get(s.origin, "/")).body.toString();
    expect(decompress(res.body).toString()).toBe(expected);
    const plain = await get(s.origin, "/", { "Accept-Encoding": "br;q=0, gzip;q=0" });
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body.toString()).toBe(expected);
    expect((await get(s.origin, "/", { "Accept-Encoding": "*;q=0" })).status).toBe(406);
    expect((await get(s.origin, "/font.woff2", { "Accept-Encoding": "br, identity;q=0" })).status).toBe(406);
  });

  it.each([false, true])("HEAD and GET select the same representation (compression busy: %s)", async (busy) => {
    const f = await fixture();
    const s = await startServer({ LD_STATIC: "on", LD_STATIC_DIR: f.root });
    const unavailable = busy ? vi.spyOn(CompressionCache.prototype, "get").mockReturnValue(undefined) : undefined;
    try {
      for (const accept of ["br", "gzip", "br, identity;q=0"]) {
        const headers = { "Accept-Encoding": accept };
        const head = await get(s.origin, "/", headers, "HEAD");
        const full = await get(s.origin, "/", headers);
        expect(head.status).toBe(busy && accept.includes("identity;q=0") ? 406 : 200);
        expect(head.status).toBe(full.status);
        expect(head.body.length).toBe(0);
        for (const key of ["content-encoding", "content-length", "content-type", "vary", "cache-control"])
          expect(head.headers[key], key).toBe(full.headers[key]);
        if (head.status === 200) {
          expect(head.headers["content-encoding"]).toBe(busy ? undefined : accept.split(",")[0]);
          expect(Number(head.headers["content-length"])).toBe(full.body.length);
        }
      }
    } finally {
      unavailable?.mockRestore();
    }
  });

  it.each(["/", "/tools/diagrams/"])(
    "matches the nginx app, embed, module and auth security policy at %s",
    async (base) => {
      const f = await fixture();
      const s = await startServer({ LD_STATIC: "on", LD_STATIC_DIR: f.root, LD_BASE: base });
      expect(await verifyInstance(`${s.origin}${base}`, { frameAncestors })).toEqual([]);
      const nginx = nginxServer({ frameAncestors, base });
      const policies = selfHostHeaderManifest({ frameAncestors });
      for (const h of [policies.app, policies.embed, policies.script])
        for (const value of Object.values(h)) expect(nginx).toContain(`"${value}"`);
      expect(nginx).toContain('~/auth\\.html$ "";');
      // Interpret the generated nginx maps and add_header directives for the same requests.
      for (const suffix of ["", "?embed=1&host=1", "embed/live-diagram.js", "auth.html"]) {
        const path = `${base}${suffix.split("?")[0]}`;
        const query = suffix.split("?")[1] ?? "";
        const vars = new Map<string, string>();
        for (const match of nginx.matchAll(/map ([^\n]+) (\$\w+) \{\n([\s\S]*?)\n\}/g)) {
          const [, source, name, body] = match;
          const input = source
            .replaceAll('"', "")
            .replaceAll("$args", query)
            .replaceAll("$uri", path)
            .replaceAll("$status", "200");
          let value = body.match(/default "([^"]*)";/)?.[1] ?? "";
          for (const rule of body.matchAll(/^\s+"?~([^"\n]+?)"? "([^"]*)";$/gm))
            if (new RegExp(rule[1]).test(input)) {
              value = rule[2];
              break;
            }
          vars.set(name, value);
        }
        const response = await get(s.origin, `${base}${suffix}`);
        for (const match of nginx.matchAll(/add_header ([\w-]+) "([^"]+)" always;/g)) {
          const [, key, raw] = match;
          const value = vars.get(raw) ?? raw;
          expect(response.headers[key.toLowerCase()] ?? "", `${suffix}: ${key}`).toBe(value);
        }
      }
      const auth = await get(s.origin, `${base}auth.html`);
      expect(auth.headers["cross-origin-opener-policy"]).toBeUndefined();
      const error = await get(s.origin, `${base}assets/missing.js`);
      expect(error.headers["content-security-policy"]).toBe(policies.app["Content-Security-Policy"]);
      expect(error.headers["cache-control"]).toBe("no-store");
    },
  );

  it.each(["index", "manifest", "invalid-manifest", "script-cache"])(
    "refuses startup with missing/invalid %s",
    async (kind) => {
      const f = await fixture();
      if (kind === "invalid-manifest") await writeFile(join(f.root, "headers.json"), "{}");
      else if (kind === "script-cache")
        await writeFile(
          join(f.root, "headers.json"),
          JSON.stringify({ ...selfHostHeaderManifest({ frameAncestors }), script: {} }),
        );
      else await rm(join(f.root, kind === "index" ? "index.html" : "headers.json"));
      const relay = createRelayServer({
        config: readConfig({ LD_HOST: "127.0.0.1", LD_PORT: "0", LD_STATIC_DIR: f.root }),
      });
      onTestFinished(() => relay.close());
      await expect(relay.listen()).rejects.toThrow();
      expect(relay.server.listening).toBe(false);
    },
  );
});

describe("server operations", () => {
  it("removes readiness when the relay stops while HTTP remains live", async () => {
    const s = await startServer();
    await new Promise<void>((resolve) => s.wss.close(() => resolve()));
    expect((await get(s.origin, "/healthz")).status).toBe(200);
    expect((await get(s.origin, "/readyz")).status).toBe(503);
  });
  it("supports relay-only mode without a static directory; health is independent of base", async () => {
    const s = await startServer({ LD_STATIC: "off", LD_STATIC_DIR: "does-not-exist", LD_BASE: "/tools/" });
    expect((await get(s.origin, "/healthz?probe=1")).status).toBe(200);
    expect((await get(s.origin, "/readyz")).status).toBe(200);
    expect((await get(s.origin, "/tools/")).status).toBe(404);
    expect((await get(s.origin, "/metrics")).status).toBe(404);
    const a = await connect(s, s.origin, room);
    await barrier(a.socket);
    expect(s.rooms.size).toBe(1);
    s.drain();
    expect((await get(s.origin, "/healthz")).status).toBe(200);
    expect((await get(s.origin, "/readyz")).status).toBe(503);
    expect(await rejectUpgrade(s)).toBe(503);
    expect(await a.closed).toBe(RELAY_CLOSE.restart);
  });

  it("exports aggregate Prometheus counters, refusals, buffer budgets and room sizes without identifiers", async () => {
    const s = await startServer({ LD_METRICS: "1" });
    const a = await connect(s, s.origin, room);
    const b = await connect(s, s.origin, room);
    await Promise.all([a, b].map((c) => barrier(c.socket)));
    const before = await get(s.origin, "/metrics");
    const canary = "metrics-payload-canary";
    a.socket.send(clientFrame(Buffer.from(canary)));
    await barrier(a.socket);
    await barrier(b.socket);
    expect(await rejectUpgrade(s, { origin: "https://other.invalid" })).toBe(403);
    const res = await get(s.origin, "/metrics");
    const text = res.body.toString();
    const metric = (body: string, name: string) => Number(body.match(new RegExp(`^${name} (\\d+)$`, "m"))?.[1]);
    expect(res.headers["content-type"]).toContain("version=0.0.4");
    expect(text).toContain("rooms_active 1\n");
    expect(text).toContain("sockets_active 2\n");
    expect(metric(text, "bytes_in_total") - metric(before.body.toString(), "bytes_in_total")).toBe(
      Buffer.byteLength(canary) + 1,
    );
    expect(metric(text, "bytes_out_total") - metric(before.body.toString(), "bytes_out_total")).toBe(
      Buffer.byteLength(canary) + 9,
    );
    expect(text).toContain('refusals_total{reason="origin"} 1');
    expect(text).toContain(`buffer_budget_bytes ${s.config.totalBufferBytes}`);
    expect(text).toContain(`buffer_bytes ${2 * RELAY_LIMITS.closeFrameBytes}`);
    expect(text).toContain("# TYPE rooms_by_size gauge\n");
    expect(text).toContain('rooms_by_size{size="1"} 0');
    expect(text).toContain('rooms_by_size{size="2"} 1');
    expect(text).not.toContain("room_size_");
    for (const secret of [room, canary, "127.0.0.1"]) expect(text).not.toContain(secret);
    b.socket.close();
    await b.closed;
    const departed = (await get(s.origin, "/metrics")).body.toString();
    expect(departed).toContain('rooms_by_size{size="1"} 1');
    expect(departed).toContain('rooms_by_size{size="2"} 0');
    a.socket.close();
    await a.closed;
    const empty = (await get(s.origin, "/metrics")).body.toString();
    expect(empty).toContain("rooms_active 0\n");
    expect(empty).toContain('rooms_by_size{size="1"} 0');
  });

  it("logs IPs only when opted in, with whitelisted JSON fields", async () => {
    const s = await startServer({ LD_LOG_IPS: "1" });
    const a = await connect(s, s.origin, room);
    await barrier(a.socket);
    expect(s.logs.some((line) => JSON.parse(line).ip === "127.0.0.1")).toBe(true);
    expect(s.logs.join("\n")).not.toContain(room);
  });

  it("stops the listener and closes relay sockets with 1012, idempotently", async () => {
    const s = await startServer();
    const a = await connect(s, s.origin, room);
    await barrier(a.socket);
    const stopped = s.shutdown();
    expect(s.server.listening).toBe(false);
    expect(s.shutdown()).toBe(stopped);
    expect(await a.closed).toBe(RELAY_CLOSE.restart);
    await stopped;
    expect(s.rooms.size).toBe(0);
    expect(s.outbound.bufferedBytes).toBe(0);
    expect(s.logs.map((s) => JSON.parse(s).event)).toContain("stopped");
    await expect(get(s.origin, "/healthz")).rejects.toThrow();
  });

  it("forces unresponsive relay and incomplete HTTP connections closed at the fake-clock drain deadline", async () => {
    const clock = new FakeClock();
    const s = await startServer({}, clock);
    const a = await connect(s, s.origin, room);
    await barrier(a.socket);
    a.socket.pause();
    const ws = [...s.wss.clients][0];
    const accepted = once(s.server, "connection");
    const http = createConnection({ host: "127.0.0.1", port: Number(new URL(s.origin).port) });
    http.on("error", () => {});
    onTestFinished(() => {
      http.destroy();
    });
    await once(http, "connect");
    const [serverSocket] = await accepted;
    const destroy = vi.spyOn(serverSocket, "destroy");
    http.write("GET / HTTP/1.1\r\nHost:");
    const httpClosed = new Promise<void>((resolve) => http.once("close", () => resolve()));
    const terminate = vi.spyOn(ws, "terminate");
    const stopped = s.shutdown();
    clock.advance(s.config.drainTimeoutMs - 1);
    expect(terminate).not.toHaveBeenCalled();
    expect(destroy).not.toHaveBeenCalled();
    expect(serverSocket.destroyed).toBe(false);
    clock.advance(1);
    expect(terminate).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
    a.socket.resume();
    await stopped;
    await httpClosed;
    await a.closed;
    expect(clock.pending).toBe(0);
    expect(s.wss.clients.size).toBe(0);
  });

  it("shutdown lets an in-flight HTTP response finish before the deadline", async () => {
    const clock = new FakeClock();
    const f = await fixture();
    const s = await startServer({ LD_STATIC: "on", LD_STATIC_DIR: f.root }, clock);
    let response!: ServerResponse;
    const original = s.server.listeners("request");
    s.server.removeAllListeners("request");
    s.server.on("request", (req, res) => {
      if (req.url === "/held-response") {
        response = res;
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.write("first chunk\n");
      } else for (const listener of original) listener.call(s.server, req, res);
    });
    const req = request(`${s.origin}/held-response`, { agent: false });
    req.on("error", () => {});
    onTestFinished(() => {
      req.destroy();
    });
    const received = once(req, "response");
    req.end();
    const [incoming] = await received;
    const chunks: Buffer[] = [];
    const first = once(incoming, "data");
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    const ended = once(incoming, "end");
    // Keep a deliberate premature-close regression from leaking an unhandled rejection.
    void ended.catch(() => {});
    await first;
    if (!response.socket) throw new Error("Expected active response socket");
    const destroy = vi.spyOn(response.socket, "destroy");
    const stopped = s.shutdown();
    clock.advance(s.config.drainTimeoutMs - 1);
    expect(destroy).not.toHaveBeenCalled();
    expect(response.destroyed).toBe(false);
    response.end("last chunk\n");
    await ended;
    await stopped;
    expect(Buffer.concat(chunks).toString()).toBe("first chunk\nlast chunk\n");
    expect(clock.pending).toBe(0);
  });

  it("releases IP and total admission after ws rejects a malformed handshake", async () => {
    const s = await startServer({ LD_SOCKETS_PER_IP: "1", LD_MAX_SOCKETS: "1" });
    const tcpClosed = new Promise<void>((resolve) =>
      s.server.once("connection", (socket) => socket.once("close", () => resolve())),
    );
    const bad = await get(s.origin, "/collab/v1", {
      Connection: "Upgrade",
      Upgrade: "websocket",
      Origin: s.origin,
      "Sec-WebSocket-Protocol": RELAY_SUBPROTOCOL,
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": "invalid",
    });
    expect(bad.status).toBe(400);
    await tcpClosed;
    const a = await connect(s, s.origin, room);
    await barrier(a.socket);
    expect(s.rooms.size).toBe(1);
  });

  it.each(["broadcast", "addressed"])(
    "preserves the full session frame at minimum LD_MAX_PAYLOAD for %s",
    async (kind) => {
      const s = await startServer({ LD_MAX_PAYLOAD: String(RELAY_LIMITS.minPayload) });
      const a = await connect(s, s.origin, room);
      const b = await connect(s, s.origin, room);
      await Promise.all([a, b].map((c) => barrier(c.socket)));
      const welcome = parseControl(Buffer.from(a.messages[0].bytes).toString());
      const recipient = parseControl(Buffer.from(b.messages[0].bytes).toString());
      if (welcome?.t !== "welcome" || recipient?.t !== "welcome") throw new Error("Expected welcome");
      const frameSize = COLLAB_LIMITS.maxDocFrameBytes;
      expect(welcome.maxFrame).toBe(frameSize);
      const envelope = new Uint8Array(frameSize).fill(42);
      const delivered = once(b.socket, "message");
      a.socket.send(clientFrame(envelope, kind === "addressed" ? recipient.self : undefined));
      const [raw] = await Promise.race([
        delivered,
        a.closed.then((code) => {
          throw new Error(`Sender closed before delivery: ${code}`);
        }),
      ]);
      expect(readServerFrame(raw)?.envelope).toEqual(envelope);
      expect(readServerFrame(raw)?.from).toBe(welcome.self);
      const received = b.messages.filter((m) => m.binary).length;
      a.socket.send(clientFrame(new Uint8Array(frameSize + 1), kind === "addressed" ? recipient.self : undefined));
      expect(await a.closed).toBe(1009);
      await barrier(b.socket);
      expect(b.messages.filter((m) => m.binary)).toHaveLength(received);
    },
  );
});
