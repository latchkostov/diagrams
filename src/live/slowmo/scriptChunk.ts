import { loadOnce } from "../../lib/lazyLoad";
import type * as Script from "./script";

// Most of slow motion is its script (src/live/slowmo/script.ts): how a recorded journey is paced, captioned and drawn
// frame by frame. It is only needed once slow motion starts, so it downloads then, not with the live view; while it
// downloads the session is capturing (src/live/slowmo/session.ts), as it is while it records the journey.

/** The script code slow motion runs once it has a journey. */
export type SlowScriptCode = Pick<typeof Script, "buildScript" | "frameAt" | "stepStop">;

let loaded: SlowScriptCode | undefined;
let painter: typeof Script.SlowPainter | undefined;

/** Downloads the script code once; a failed download is forgotten, so the next start retries it. */
export const loadSlowScript: () => Promise<SlowScriptCode> = loadOnce(() =>
  import("./script").then((code) => {
    painter = code.SlowPainter;
    return (loaded = code);
  }),
);

/** The script code, once it has arrived. */
export const slowScript = (): SlowScriptCode | undefined => loaded;

/** Slow motion's painter, which arrives in the script's chunk. */
export const slowPainter = (): typeof Script.SlowPainter | undefined => painter;
