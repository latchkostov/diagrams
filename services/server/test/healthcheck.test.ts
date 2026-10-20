import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { healthcheck } from "../src/healthcheck";

describe("distroless healthcheck", () => {
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
