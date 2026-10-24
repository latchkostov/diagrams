import { loadOnce } from "../../lib/lazyLoad";
import type * as Script from "./replay";

// The replay facade keeps the pure script, browser adapters, camera and painter in one lazy download.
// It is only needed once slow motion starts, so it downloads then, not with the live view; while it
// downloads the session is capturing (src/live/slowmo/session.ts), as it is while it records the journey.

/** The script code slow motion runs once it has a journey. */
export type SlowScriptCode = Pick<typeof Script, "buildScript" | "frameAt" | "stepStop">;

type LoadedScript = SlowScriptCode &
  Pick<typeof Script, "planCamera" | "followPan" | "followTargets" | "screenScript" | "publishReplay">;
let loaded: LoadedScript | undefined;
let painter: typeof Script.SlowPainter | undefined;

/** Downloads the script code once; a failed download is forgotten, so the next start retries it. */
export const loadSlowScript: () => Promise<SlowScriptCode> = loadOnce(() =>
  import("./replay").then((code) => {
    painter = code.SlowPainter;
    return (loaded = code);
  }),
);

/** The script code, once it has arrived. */
export const slowScript = (): LoadedScript | undefined => loaded;

/** Slow motion's painter, which arrives in the script's chunk. */
export const slowPainter = (): typeof Script.SlowPainter | undefined => painter;
