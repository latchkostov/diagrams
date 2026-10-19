import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

// The simulation engine's version (shared Live design, P1): a hash of the code that decides what a tick does, the
// simulator (src/sim), the model it reads (src/model) and the stencil data it runs on (src/stencils: roles, device
// throughput, family defaults), tests left out. Two copies of Live Diagrams with the
// same version run a simulation identically, so a follower can play the driver's ops; different versions can't
// follow each other (shared Live says "Reload to watch"). vite.config.ts defines it as __ENGINE_VERSION__.

/** What decides a tick: also the code src/sim/determinism.test.ts keeps free of engine-dependent maths. */
export const ENGINE_SOURCES = ["src/sim", "src/model", "src/stencils"];
const isSource = (name: string) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name);

function files(root: string, dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? files(root, join(dir, entry.name)) : isSource(entry.name) ? [join(dir, entry.name)] : [],
    )
    .sort();
}

/** 12 hex digits: the files' paths and contents (line endings normalised, so a checkout's settings don't count). */
export function engineVersion(root: string): string {
  const hash = createHash("sha256");
  for (const file of ENGINE_SOURCES.flatMap((dir) => files(root, dir))) {
    hash.update(relative(root, join(root, file)).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(join(root, file), "utf8").replace(/\r\n/g, "\n"));
    hash.update("\0");
  }
  return hash.digest("hex").slice(0, 12);
}
