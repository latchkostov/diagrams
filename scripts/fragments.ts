import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const streams = {
  release: { title: "Release notes", directory: "release-notes", history: "RELEASE-NOTES-HISTORY.md" },
  design: { title: "Design review", directory: "design-review", history: "DESIGN-REVIEW-HISTORY.md" },
  backlog: { title: "Backlog", directory: "backlog", history: null },
} as const;
export type Stream = keyof typeof streams;

export function validateFragment(name: string, text: string): string[] {
  const errors: string[] = [];
  const match = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.exec(name);
  const date = match ? new Date(`${match[1]}T00:00:00Z`) : null;
  if (!match || !date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1])
    errors.push("use YYYY-MM-DD-short-slug.md with a real date");
  if (!text.trim()) errors.push("fragment is empty");
  if (!/^## \S.*$/m.test(text)) errors.push("include a level-two heading, as in the historical sections");
  return errors;
}

export function readFragments(root: string, stream: Stream): { name: string; text: string }[] {
  const directory = join(root, "docs", streams[stream].directory);
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map(({ name }) => {
      const text = readFileSync(join(directory, name), "utf8").replaceAll("\r\n", "\n");
      const errors = validateFragment(name, text);
      if (errors.length) throw new Error(`${directory}/${name}: ${errors.join("; ")}`);
      return { name, text };
    })
    .sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
}

/** An on-demand document, never a committed compilation. Offline packages embed this same view. */
export function combinedNotes(root: string, stream: Stream = "release"): string {
  const { title, history } = streams[stream];
  const sections = readFragments(root, stream).map(({ text }) => text.trim());
  if (history)
    sections.push(
      readFileSync(join(root, "docs", history), "utf8")
        .replace(/^# .+\r?\n/, "")
        .trim(),
    );
  return `# ${title}\n\n${sections.join("\n\n")}\n`;
}
