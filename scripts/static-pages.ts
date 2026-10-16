import path from "node:path";
import { build, type Plugin, type Rollup } from "vite";
import { deploymentDefines, resolveDeploymentEnv } from "./deployment-env";
import { i18n } from "./i18n-plugin";

const PAGES = { "auth.js": "auth", "skill/copy.js": "skill" };

/** Classic scripts at the existing URLs: English keeps the authored DOM, including on offline/file:// copies. */
export async function buildStaticScript(root: string, page: string, mode = "production", dev = false) {
  const prefix = `static${page.charAt(0).toUpperCase()}${page.slice(1)}.`;
  const result = await build({
    configFile: false,
    root,
    mode,
    logLevel: "silent",
    plugins: [i18n({ prefix, pseudo: dev })],
    define: deploymentDefines(resolveDeploymentEnv(mode, root)),
    build: {
      write: false,
      copyPublicDir: false,
      modulePreload: false,
      rolldownOptions: {
        input: path.join(root, `src/static/${page}.ts`),
        output: { format: "iife", codeSplitting: false },
      },
    },
  });
  const output = (Array.isArray(result) ? result : [result]).flatMap((r) => (r as Rollup.RolldownOutput).output);
  if (output.length !== 1 || output[0].type !== "chunk") throw new Error(`static page ${page}: expected one script`);
  return output[0].code;
}

export function staticPages(): Plugin {
  let root: string;
  let mode: string;
  let base: string;
  return {
    name: "static-pages",
    configResolved(config) {
      ({ root, mode, base } = config);
    },
    async generateBundle() {
      for (const [fileName, page] of Object.entries(PAGES))
        this.emitFile({ type: "asset", fileName, source: await buildStaticScript(root, page, mode) });
    },
    configureServer(server) {
      const cache = new Map<string, Promise<string>>();
      server.watcher.on("all", () => cache.clear());
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split(/[?#]/)[0].replace(base, "").replace(/^\//, "");
        const page = PAGES[url as keyof typeof PAGES];
        if (!page) return next();
        let script = cache.get(page);
        if (!script) cache.set(page, (script = buildStaticScript(root, page, mode, true)));
        void script.then((code) => {
          res.setHeader("Content-Type", "text/javascript; charset=utf-8");
          res.end(code);
        }, next);
      });
    },
  };
}
