import { randomBytes, randomUUID } from "node:crypto";
import { on, once } from "node:events";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import console from "node:console";
import { URL } from "node:url";
import { expect } from "@playwright/test";

const { fetch, AbortSignal } = globalThis;
// ws belongs to the server workspace, rather than the browser application's dependencies.
const { WebSocket } = createRequire(new URL("../services/server/package.json", import.meta.url))("ws");

async function receive(socket, binary) {
  // A hang backstop, not a performance assertion. Ignore membership notices while awaiting data.
  for await (const [data, isBinary] of on(socket, "message", {
    signal: AbortSignal.timeout(30_000),
    close: ["close"],
  })) {
    if (isBinary === binary) return binary ? new Uint8Array(data) : JSON.parse(data.toString());
  }
  throw new Error("WebSocket closed before delivering the expected frame");
}

async function exerciseRelay(origin, base, protocol) {
  const url = `${origin.replace("http:", "ws:")}${base}collab/v1`;
  const sockets = [];
  const open = (requestOrigin, forwarded) => {
    const socket = new WebSocket(url, protocol.RELAY_SUBPROTOCOL, {
      origin: requestOrigin,
      headers: forwarded ? { "X-Forwarded-For": forwarded } : {},
      handshakeTimeout: 30_000,
    });
    sockets.push(socket);
    socket.on("error", () => {});
    return socket;
  };
  const refuse = async (requestOrigin, forwarded, status) => {
    const socket = open(requestOrigin, forwarded);
    const response = await new Promise((resolve, reject) => {
      socket.once("unexpected-response", (_req, res) => {
        res.resume();
        resolve(res.statusCode);
        socket.terminate();
      });
      socket.once("open", () => reject(new Error("Refused request was upgraded")));
      socket.once("error", reject);
    });
    expect(response).toBe(status);
  };
  try {
    await refuse("https://unapproved.example", "198.51.100.10", 403);
    const room = randomBytes(32).toString("base64url");
    const peers = [];
    for (const prefix of ["198.51.100.11", "198.51.100.12"]) {
      const socket = open(origin, prefix);
      await once(socket, "open");
      const welcome = receive(socket, false);
      socket.send(JSON.stringify({ t: "hello", v: 1, room }));
      const control = await welcome;
      expect(control.t).toBe("welcome");
      peers.push({ socket, self: control.self });
    }
    for (const [sender, recipient] of [peers, [...peers].reverse()]) {
      const envelope = new Uint8Array(randomBytes(32));
      const delivered = receive(recipient.socket, true);
      sender.socket.send(protocol.clientFrame(envelope));
      expect(protocol.readServerFrame(await delivered)).toEqual({ from: sender.self, envelope });
    }
    // Both admitted sockets remain open: neither rotating a spoofed prefix nor omitting XFF
    // may escape the two-socket quota of the observed client behind this one trusted hop.
    await refuse(origin, "198.51.100.13, 198.51.100.14", 429);
    await refuse(origin, undefined, 429);
  } finally {
    await Promise.all(
      sockets.map(async (socket) => {
        if (socket.readyState === WebSocket.CLOSED) return;
        const closed = once(socket, "close");
        socket.terminate();
        await closed;
      }),
    );
  }
}

/** Deployment variants forward collaboration at root and subpaths. */
export async function deploymentVariants({ run, image, scratch, hostingTemplates, waitForStableEndpoint, protocol }) {
  for (const base of ["/", "/tools/diagrams/"]) {
    for (const proxy of ["nginx", "caddy"]) {
      for (const relayOnly of [false, true]) {
        const suffix = randomUUID();
        const network = `ld-proxy-smoke-${suffix}`;
        const proxyName = `ld-proxy-${suffix}`;
        const serverName = `ld-relay-${suffix}`;
        const templates = hostingTemplates({ base });
        const target =
          proxy === "nginx"
            ? relayOnly
              ? "server/relay-only.nginx.conf"
              : "nginx/nginx.server.conf"
            : relayOnly
              ? "server/relay-only.Caddyfile"
              : "caddy/Caddyfile.server";
        let config = templates[target];
        if (proxy === "nginx" && relayOnly) {
          // The relay-only template is an http map plus a location for an existing server.
          const location = config.indexOf("\nlocation ") + 1;
          if (!location) throw new Error("Missing nginx relay location");
          config = `${config.slice(0, location)}server { listen 8080;\n${config.slice(location)}\nlocation / { return 404; }\n}\n`;
        } else if (proxy === "caddy" && relayOnly) {
          config = config
            .replace(":8080 {", ":8080 {\n    route {")
            .replace(/\n}\n$/, "\n        respond 404\n    }\n}\n");
        }
        const file = path.join(scratch, `${suffix}.conf`);
        await writeFile(file, config);
        const nginx = proxy === "nginx";
        const proxyImage = nginx ? "nginxinc/nginx-unprivileged:stable-alpine" : "caddy:2-alpine";
        const configPath = nginx ? "/etc/nginx/conf.d/default.conf" : "/etc/caddy/Caddyfile";
        const containers = [];
        run("docker", ["network", "create", network]);
        try {
          // Allocate the proxy's published port before configuring LD_ORIGIN. Start the actual
          // proxy only after diagrams exists on this isolated network (nginx resolves at startup).
          containers.push(
            run(
              "docker",
              [
                "create",
                "--name",
                proxyName,
                "--network",
                network,
                "--read-only",
                "--tmpfs",
                nginx ? "/tmp:uid=101,gid=101" : "/tmp",
                "--cap-drop=ALL",
                // The Caddy image's binary carries this file capability, even on port 8080.
                ...(!nginx ? ["--cap-add=NET_BIND_SERVICE"] : []),
                "--security-opt",
                "no-new-privileges:true",
                "-p",
                "127.0.0.1::8080",
                "-v",
                `${file}:${configPath}:ro`,
                "-e",
                "XDG_CONFIG_HOME=/tmp/config",
                "-e",
                "XDG_DATA_HOME=/tmp/data",
                proxyImage,
                "sleep",
                "infinity",
              ],
              true,
            ).trim(),
          );
          run("docker", ["start", proxyName]);
          const binding = run("docker", ["port", proxyName, "8080/tcp"], true).trim();
          if (!/^127\.0\.0\.1:\d+$/.test(binding)) throw new Error(`Unexpected proxy binding: ${binding}`);
          const origin = `http://${binding}`;
          containers.push(
            run(
              "docker",
              [
                "create",
                "--name",
                serverName,
                "--network",
                network,
                "--network-alias",
                "diagrams",
                "--read-only",
                "--cap-drop=ALL",
                "--security-opt",
                "no-new-privileges:true",
                "-e",
                `LD_BASE=${base}`,
                "-e",
                `LD_STATIC=${relayOnly ? "off" : "on"}`,
                "-e",
                `LD_ORIGIN=${origin}`,
                "-e",
                "LD_TRUST_PROXY=1",
                "-e",
                "LD_TRUST_PROXY_HOPS=1",
                "-e",
                "LD_SOCKETS_PER_IP=2",
                image,
              ],
              true,
            ).trim(),
          );
          run("docker", ["start", serverName]);
          run("docker", [
            "exec",
            proxyName,
            ...(nginx ? ["nginx", "-t"] : ["caddy", "validate", "--config", configPath, "--adapter", "caddyfile"]),
          ]);
          run("docker", [
            "exec",
            "-d",
            proxyName,
            ...(nginx
              ? ["nginx", "-g", "daemon off;"]
              : ["caddy", "run", "--config", configPath, "--adapter", "caddyfile"]),
          ]);
          await waitForStableEndpoint(`${origin}${base}collab/v1`, async (address) => {
            const response = await fetch(address, { signal: AbortSignal.timeout(2_000) });
            await response.arrayBuffer();
            return response.status === 501;
          });
          expect((await fetch(`${origin}${base}`)).status).toBe(relayOnly ? 404 : 200);
          await exerciseRelay(origin, base, protocol);
          console.log(
            `PASS deployment variants forward collaboration at root and subpaths: ${proxy} ${base} LD_STATIC=${relayOnly ? "off" : "on"}; two-way frames, origin and spoofed-XFF admission`,
          );
        } finally {
          try {
            if (containers.length) run("docker", ["rm", "-f", ...containers.reverse()]);
          } finally {
            run("docker", ["network", "rm", network]);
          }
        }
      }
    }
  }
}
