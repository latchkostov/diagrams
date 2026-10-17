import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, ViteDevServer } from "vite";
import { expect, it, vi } from "vitest";
import { schemaAssets } from "../../scripts/schema-assets";
import * as schemas from "../ai/webmcp/publicSchemas";

it.each(["/", "/tools/diagrams/"])(
  "serves dev schemas under base %s and passes other requests through",
  async (base) => {
    let middleware: Connect.NextHandleFunction | undefined;
    const server = {
      config: { base },
      middlewares: {
        use: (handler: Connect.NextHandleFunction) => {
          middleware = handler;
        },
      },
    };
    const configure = schemaAssets().configureServer;
    if (typeof configure !== "function") throw new Error("Missing dev schema server");
    await configure.call({} as ThisParameterType<typeof configure>, server as unknown as ViteDevServer);
    const setHeader = vi.fn();
    const end = vi.fn();
    const next = vi.fn();
    const response = { setHeader, end } as unknown as ServerResponse;
    const request = (url: string) => {
      if (!middleware) throw new Error("Missing schema middleware");
      middleware({ url } as IncomingMessage, response, next);
    };
    for (const [name, text] of Object.entries(schemas.publicSchemaFiles())) {
      request(`${base}schema/${name}?cache=1`);
      expect(setHeader).toHaveBeenLastCalledWith("Content-Type", "application/json; charset=utf-8");
      expect(end).toHaveBeenLastCalledWith(text);
    }
    expect(next).not.toHaveBeenCalled();
    for (const url of ["/", "/assets/app.js", `${base}schema/missing.json`, `${base}schema/toString`]) request(url);
    expect(next).toHaveBeenCalledTimes(4);
    if (base !== "/") {
      request("/schema/diagram.v1.json");
      expect(next).toHaveBeenCalledTimes(5);
    }
  },
);

it("serializes once per dev server, without sharing a stale cache between servers", async () => {
  const serialize = vi.spyOn(schemas, "publicSchemaFiles");
  try {
    const configure = schemaAssets().configureServer;
    if (typeof configure !== "function") throw new Error("Missing dev schema server");
    for (let serverIndex = 0; serverIndex < 2; serverIndex++) {
      let middleware: Connect.NextHandleFunction | undefined;
      await configure.call(
        {} as ThisParameterType<typeof configure>,
        {
          config: { base: "/" },
          middlewares: {
            use: (handler: Connect.NextHandleFunction) => {
              middleware = handler;
            },
          },
        } as unknown as ViteDevServer,
      );
      const response = { setHeader: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
      for (const name of ["diagram.v1.json", "diagram.v2.json", "ops.v1.json", "stencils.json", "diagram.v1.json"]) {
        if (!middleware) throw new Error("Missing schema middleware");
        middleware({ url: `/schema/${name}` } as IncomingMessage, response, vi.fn());
      }
      expect(serialize).toHaveBeenCalledTimes(serverIndex + 1);
    }
  } finally {
    serialize.mockRestore();
  }
});
