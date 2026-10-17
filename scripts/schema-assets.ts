import type { Plugin } from "vite";
import { publicSchemaFiles } from "../src/ai/webmcp/publicSchemas";

/** Publish schemas even for direct Vite builds/servers, without committing or reading generated disk files. */
export function schemaAssets(): Plugin {
  return {
    name: "public-schemas",
    generateBundle() {
      for (const [name, source] of Object.entries(publicSchemaFiles()))
        this.emitFile({ type: "asset", fileName: `schema/${name}`, source });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/schema/")) return next();
        const name = request.url?.split("?")[0].replace(/^\/schema\//, "");
        const files = publicSchemaFiles();
        if (!name || !Object.hasOwn(files, name)) return next();
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(files[name]);
      });
    },
  };
}
