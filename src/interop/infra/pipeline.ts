import { validateDiagram } from "../native";
import type { FormatId, ImportFile, ImportOutcome } from "../formats";
import type { InfraSniff } from "../sniff";
import { readCompose, type SourceFile } from "./compose";
import { graphToDiagram } from "./map";
import { ImportError } from "./yaml";

// One pipeline for every infrastructure source (docs/research/imports.md § Pipeline): reader → ImportGraph →
// stencils and relationships → layout → validateDiagram. This module and the YAML reader load on first use.

export { ImportError };

/** At most this many files in one import. */
export const MAX_FILES = 100;

export function importCompose(files: readonly SourceFile[], others: readonly SourceFile[] = []): ImportOutcome {
  const { diagram, report } = graphToDiagram(readCompose(files, others));
  const r = validateDiagram(diagram);
  return r.ok
    ? { ok: true, format: "compose", diagram: r.diagram, warnings: r.warnings, report }
    : { ok: false, error: r.error };
}

/** Recognised, but not imported yet: said plainly rather than "not a diagram". */
const LATER: Record<InfraSniff, string> = {
  compose: "a docker-compose file",
  helm: "a Helm template",
  kubernetes: "Kubernetes manifests",
  asyncapi: "an AsyncAPI document",
  terraform: "a Terraform plan",
};

/** One text: a compose file, or a format that's recognised but not imported yet (`later`). */
export function importInfra(text: string, fileName: string, later?: InfraSniff): ImportOutcome {
  if (later)
    return {
      ok: false,
      error: `This looks like ${LATER[later]}. Importing those isn't supported yet; docker-compose files are.`,
    };
  return importCompose([{ name: fileName || "docker-compose.yml", text }]);
}

/** A .env file opened beside a compose file: read for its settings, never drawn. */
const isEnvFile = (name: string) => /(^|[\\/])\.env(\.[\w.-]+)?$|\.env$/i.test(name);

/**
 * Several files at once. They're grouped by format, and the largest group imports: a compose file with its
 * overrides (and any .env files) is one diagram. A diagram file, draw.io or Mermaid group opens its first
 * file. The rest are listed as not read.
 */
export async function importMany(
  files: readonly ImportFile[],
  detect: (text: string, name: string) => FormatId | undefined,
  importOne: (text: string, name: string) => Promise<ImportOutcome>,
): Promise<ImportOutcome> {
  if (files.length > MAX_FILES)
    return { ok: false, error: `That's ${files.length} files; one import takes at most ${MAX_FILES}.` };
  const groups = new Map<FormatId, ImportFile[]>();
  const envFiles: ImportFile[] = [];
  for (const f of files) {
    const format = detect(f.text, f.name);
    if (format) groups.set(format, [...(groups.get(format) ?? []), f]);
    else if (isEnvFile(f.name)) envFiles.push(f);
  }
  const [format, group] = [...groups].sort((a, b) => b[1].length - a[1].length)[0] ?? [];
  if (!format || !group) return importOne(files[0].text, files[0].name);
  const rest = files.filter((f) => !group.includes(f) && !(format === "compose" && envFiles.includes(f)));
  const restLines = rest.map((f) => ({ name: f.name, reason: "not read: a different kind of file" }));
  if (format === "compose") {
    try {
      const outcome = importCompose(group, envFiles);
      if (outcome.ok === true && outcome.report) outcome.report.unread.push(...restLines);
      return outcome;
    } catch (err) {
      if (err instanceof ImportError) return { ok: false, error: err.message };
      throw err;
    }
  }
  const outcome = await importOne(group[0].text, group[0].name);
  const others = files.length - 1;
  if (outcome.ok === true && others)
    outcome.warnings = [
      `Opened ${group[0].name} only: open the other ${others === 1 ? "file" : `${others} files`} one at a time.`,
      ...outcome.warnings,
    ];
  return outcome;
}
