import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { healthcheck } from "../src/healthcheck";

describe("distroless healthcheck", () => {
  it.each(["127.0.0.1", "0.0.0.0", "::1", "::"])("probes the configured %s listener", async (host) => {
    const server = createServer((_req, res) => res.writeHead(200).end());
    server.listen({ port: 0, host, ipv6Only: host.includes(":") });
    await once(server, "listening");
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing port");
      expect(await healthcheck(address.port, host)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it("checks liveness over loopback and refuses unhealthy, redirecting or absent listeners", async () => {
    let status = 200;
    const paths: string[] = [];
    const server = createServer((req, res) => {
      paths.push(req.url ?? "");
      res.writeHead(status, { Location: "/healthz" }).end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing port");
    try {
      expect(await healthcheck(address.port)).toBe(true);
      status = 503;
      expect(await healthcheck(address.port)).toBe(false);
      status = 302;
      expect(await healthcheck(address.port)).toBe(false);
      expect(paths).toEqual(["/healthz", "/healthz", "/healthz"]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await healthcheck(address.port)).toBe(false);
  });
});
