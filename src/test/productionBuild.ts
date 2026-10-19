import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, type Rollup } from "vite";
import { DEPLOYMENT_VARIABLES } from "../../scripts/deployment-env";

// A real production build of the app for the build tests (src/lib/*.build.test.ts), as `pnpm build` makes it, with
// exactly the fixture's deployment variables: none from the shell (a developer's, a self-hoster's or CI's) and no
// .env file, so a checkout configured for its own copy (its brand, its trackers) still tests what each fixture names.

export interface ProductionBuild {
  chunks: Rollup.OutputChunk[];
  assets: Rollup.OutputAsset[];
  /** index.html as built. */
  html: string;
}

export async function productionBuild(env: Record<string, string> = {}): Promise<ProductionBuild> {
  const noEnvFiles = mkdtempSync(join(tmpdir(), "production-build-"));
  const saved = { ...process.env };
  // Vitest runs with NODE_ENV=test, which Vite reads as development.
  for (const key of DEPLOYMENT_VARIABLES) Reflect.deleteProperty(process.env, key);
  Object.assign(process.env, { NODE_ENV: "production", ...env });
  let result: Awaited<ReturnType<typeof build>>;
  try {
    result = await build({
      configFile: resolve("vite.config.ts"),
      envDir: noEnvFiles,
      logLevel: "silent",
      build: { write: false },
    });
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) Reflect.deleteProperty(process.env, key);
    Object.assign(process.env, saved);
    rmSync(noEnvFiles, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
  const output = (Array.isArray(result) ? result : [result]).flatMap((r) => (r as Rollup.RolldownOutput).output);
  const page = output.find((o): o is Rollup.OutputAsset => o.type === "asset" && o.fileName === "index.html");
  return {
    chunks: output.filter((o): o is Rollup.OutputChunk => o.type === "chunk"),
    assets: output.filter((o): o is Rollup.OutputAsset => o.type === "asset"),
    html: String(page?.source ?? ""),
  };
}

/** The entry index.html loads and every chunk it imports statically: the startup JavaScript. */
export function startupChunks(b: ProductionBuild): Rollup.OutputChunk[] {
  const entry = /<script\b[^>]*type="module"[^>]*\bsrc="([^"]+)"/.exec(b.html)?.[1]?.replace(/^\.\//, "");
  const byName = new Map(b.chunks.map((c) => [c.fileName, c]));
  const seen = new Set<Rollup.OutputChunk>();
  const stack = [byName.get(entry ?? "")];
  for (let c = stack.pop(); c; c = stack.pop()) {
    if (seen.has(c)) continue;
    seen.add(c);
    for (const name of c.imports) {
      const next = byName.get(name);
      if (next) stack.push(next);
    }
  }
  return [...seen];
}
