import { readPayload } from "./payload";

// The viewer build's stand-in for src/stencils/iconUrls.ts (scripts/interactive-viewer.ts swaps it in): the
// icons are the data URIs the exported file carries, keyed as the bundled ones are ("./icons/<icon>.svg").
// None of the app's 175 icon files goes into the template; an icon the file doesn't carry falls back to the
// generic box (StencilIcon), which the export always includes when it's needed.

const payload = readPayload();

export const iconUrls: Record<string, string> = Object.fromEntries(
  Object.entries(payload.ok ? payload.icons : {}).map(([name, uri]) => [`./icons/${name}.svg`, uri]),
);
