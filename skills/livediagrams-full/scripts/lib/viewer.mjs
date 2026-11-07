// The shipped viewer is plain JavaScript/CSS plus real fonts. Join the original bytes only;
// no evaluation, decompression, downloads or transformed executable payloads.
import { readFileSync } from "node:fs";

export function assembleViewer(read) {
  const manifest = JSON.parse(read("viewer.json").toString("utf8"));
  let html = read("viewer-template.html").toString("utf8");
  for (const [marker, parts] of Object.entries(manifest)) {
    const text = parts
      .map(({ file, font }) => {
        const data = read(file);
        return font ? `data:font/woff2;base64,${data.toString("base64")}` : data.toString("utf8");
      })
      .join("");
    html = html.replace(marker, () => text);
  }
  return html;
}

export const readViewer = (lib = new URL("./", import.meta.url)) =>
  assembleViewer((file) => readFileSync(new URL(file, lib)));

export function readIcons(lib = new URL("./", import.meta.url)) {
  const files = JSON.parse(readFileSync(new URL("icons.json", lib), "utf8"));
  return Object.assign({}, ...files.map((file) => JSON.parse(readFileSync(new URL(file, lib), "utf8"))));
}
