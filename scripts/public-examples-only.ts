import type { Plugin } from "vite";

/**
 * The harness never loads src/examples/private (CLAUDE.md). Vitest runs with DEV set, where the examples registry
 * (src/examples/index.ts, reached through src/lib/diagramIO.ts) imports every local-only diagram eagerly; here its
 * glob is emptied before Vite expands it, and any module from that folder is refused outright.
 */
export function publicExamplesOnly(): Plugin {
  const PRIVATE_GLOB = 'import.meta.glob<DiagramFile>("./private/*.json", { eager: true, import: "default" })';
  return {
    name: "parity-public-examples-only",
    enforce: "pre",
    transform(code, id) {
      if (!/[/\\]src[/\\]examples[/\\]index\.ts$/.test(id)) return undefined;
      if (!code.includes(PRIVATE_GLOB))
        this.error("src/examples/index.ts no longer has the private glob tests/parity/vitest.config.ts empties");
      return code.replace(PRIVATE_GLOB, "{}");
    },
    load(id) {
      if (/[/\\]examples[/\\]private[/\\]/.test(id))
        this.error("the parity harness must not load src/examples/private");
      return undefined;
    },
  };
}
