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
      // Serialization is shared by requests to this server only. Restart Vite after schema/catalog
      // source edits: these statically imported Node modules are not reloaded by Vite's browser HMR.
      let files: Record<string, string> | undefined;
      const prefix = `${server.config.base}schema/`;
      server.middlewares.use((request, response, next) => {
        const url = request.url?.split(/[?#]/)[0];
        if (!url?.startsWith(prefix)) return next();
        const name = url.slice(prefix.length);
        files ??= publicSchemaFiles();
        if (!name || !Object.hasOwn(files, name)) return next();
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(files[name]);
      });
    },
  };
}
