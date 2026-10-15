import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hostingBase } from "./self-host-templates";

/** The Vite build uses relative assets. Anchor them when a static server serves index at a deep SPA route. */
export function prepareSite(directory: string, base = "/"): void {
  const prefix = hostingBase(base);
  const file = join(directory, "index.html");
  const html = readFileSync(file, "utf8");
  if (!html.includes("<head>")) throw new Error("Built index.html must contain a head element");
  if (/<base\b/i.test(html) && !/<base data-self-host="true"[^>]*>/i.test(html))
    throw new Error("index.html already has a base element; refusing to replace it");
  const cleaned = html.replace(/\s*<base data-self-host="true"[^>]*>/i, "");
  writeFileSync(file, cleaned.replace("<head>", `<head>\n    <base data-self-host="true" href="${prefix}">`));
}
