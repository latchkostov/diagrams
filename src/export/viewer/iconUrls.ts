import { readPayload } from "./payload";

// The viewer build's stand-in for src/stencils/iconUrls.ts (scripts/interactive-viewer.ts swaps it in): the
// icons are the data URIs the exported file carries, keyed as the bundled ones are ("./icons/<icon>.svg").
// None of the app's 175 icon files goes into the template; an icon the file doesn't carry falls back to the
// generic box (StencilIcon), which the export always includes when it's needed. A password-protected file's icons
// are encrypted with its diagram: they're added once it's unlocked (addIcons), before the canvas first renders.

const payload = readPayload();

export const iconUrls: Record<string, string> = {};

/** The file's icons (name → data URI), keyed as the registry looks them up. */
export function addIcons(icons: Readonly<Record<string, string>>): void {
  for (const [name, uri] of Object.entries(icons)) iconUrls[`./icons/${name}.svg`] = uri;
}

if (payload.ok) addIcons(payload.icons);

export function iconUrl(icon: string): string | undefined {
  return iconUrls[`./icons/${icon}.svg`];
}
