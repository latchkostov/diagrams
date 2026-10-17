import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, ViteDevServer } from "vite";
import { expect, it, vi } from "vitest";
import { schemaAssets } from "../../scripts/schema-assets";
import { publicSchemaFiles } from "../ai/webmcp/publicSchemas";

it("serves schemas from the dev server without generated files, and passes other requests through", async () => {
  let middleware: Connect.NextHandleFunction | undefined;
  const server = {
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
  for (const [name, text] of Object.entries(publicSchemaFiles())) {
    request(`/schema/${name}?cache=1`);
    expect(setHeader).toHaveBeenLastCalledWith("Content-Type", "application/json; charset=utf-8");
    expect(end).toHaveBeenLastCalledWith(text);
  }
  expect(next).not.toHaveBeenCalled();
  for (const url of ["/", "/assets/app.js", "/schema/missing.json", "/schema/toString"]) request(url);
  expect(next).toHaveBeenCalledTimes(4);
});
