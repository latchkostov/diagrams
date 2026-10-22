import type { DiagramFile } from "../model/types";
import type { Finding } from "../checks/types";

/**
 * Where the editor gets request findings: the checks worker (src/lib/requestCheckCache.ts keeps what it returns).
 * Apart from that cache so the editor's startup registers it for a few bytes. With nothing registered (headless
 * tools, tests, the worker itself) checks work request findings out where they run. Exported files register nothing.
 */
let provider: ((d: DiagramFile) => Promise<Finding[]>) | undefined;
let generation = 0;
export function registerRequestChecks(fn: typeof provider): void {
  provider = fn;
  generation++;
}
export const requestCheckProvider = () => provider;
/** Changes with each registration: the cache starts again for a new provider. */
export const requestCheckGeneration = () => generation;
