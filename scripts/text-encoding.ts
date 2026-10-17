import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Check decoded JSON too: ASCII escapes can conceal a previous Windows-1252 misdecode. */
export function assertTextEncoding(name: string, text: string): void {
  const decoded = name.endsWith(".json") ? JSON.stringify(JSON.parse(text)) : text;
  if (text.startsWith("\uFEFF") || /\u00c3|\u00e2\u20ac|\u00c2/.test(decoded))
    throw new Error(`${name}: expected UTF-8 without BOM or mojibake`);
}

/** Only known text surfaces; never inspect examples or unrelated local files. */
export function checkRepositoryTextEncoding(root: string): void {
  const check = (name: string) => assertTextEncoding(name, readFileSync(join(root, name), "utf8"));
  const directory = (name: string, recursive: boolean) => {
    for (const entry of readdirSync(join(root, name), { withFileTypes: true })) {
      const file = `${name}/${entry.name}`;
      if (entry.isDirectory() && recursive) directory(file, true);
      else if (entry.isFile() && /\.(?:md|json|mjs|html)$/.test(file)) check(file);
    }
  };
  check(".claude-plugin/marketplace.json");
  directory("skills/livediagrams", true);
  for (const stream of ["release-notes", "design-review", "backlog"]) directory(`docs/${stream}`, false);
  for (const history of ["RELEASE-NOTES", "DESIGN-REVIEW"]) check(`docs/${history}-HISTORY.md`);
}
