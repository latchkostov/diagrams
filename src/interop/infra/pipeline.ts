import { validateDiagram } from "../native";
import type { FormatId, ImportFile, ImportOutcome } from "../formats";
import { sniffInfra, type InfraSniff } from "../sniff";
import { readCompose, type SourceFile } from "./compose";
import { readAsyncApi } from "./asyncapi";
import { HELM_TEMPLATE, readKubernetes } from "./kubernetes";
import { readTerraform, TERRAFORM_BINARY, TERRAFORM_SOURCE } from "./terraform";
import type { ImportGraph } from "./graph";
import { graphToDiagram } from "./map";
import { ImportError } from "./yaml";

// One pipeline for every infrastructure source (docs/research/imports.md § Pipeline): reader → ImportGraph →
// stencils and relationships → layout → validateDiagram. This module and the YAML reader load on first use.

export { ImportError };

/** At most this many files in one import. */
export const MAX_FILES = 100;

/** The shared tail of every infrastructure import: map, lay out, validate. */
function outcomeOf(format: FormatId, graph: ImportGraph): ImportOutcome {
  const { diagram, report } = graphToDiagram(graph);
  const r = validateDiagram(diagram);
  return r.ok ? { ok: true, format, diagram: r.diagram, warnings: r.warnings, report } : { ok: false, error: r.error };
}

export function importCompose(files: readonly SourceFile[], others: readonly SourceFile[] = []): ImportOutcome {
  return outcomeOf("compose", readCompose(files, others));
}

/** One or several AsyncAPI documents, joined on their channels. */
export function importAsyncApi(files: readonly SourceFile[]): ImportOutcome {
  return outcomeOf("asyncapi", readAsyncApi(files));
}

/** Kubernetes manifests: several files (and multi-document files) are one diagram. */
export function importKubernetes(files: readonly SourceFile[]): ImportOutcome {
  return outcomeOf("kubernetes", readKubernetes(files));
}

/**
 * Terraform plan or state JSON (`terraform show -json`), one or several files. When something isn't drawn, the
 * outcome also carries the same import with every resource as a node (`replay`, for **Draw everything**): read now,
 * as data, so no source text outlives the import.
 */
export function importTerraform(files: readonly SourceFile[]): ImportOutcome {
  const outcome = outcomeOf("terraform", readTerraform(files));
  if (outcome.ok === true && outcome.report?.notDrawn.length)
    try {
      outcome.replay = readTerraform(files, { everything: true });
    } catch (err) {
      if (!(err instanceof ImportError)) throw err;
    }
  return outcome;
}

/** An import's replay (Terraform's Draw everything), drawn: the shared map, layout and validation. */
export function replayOutcome(graph: ImportGraph): ImportOutcome {
  try {
    return outcomeOf("terraform", graph);
  } catch (err) {
    if (err instanceof ImportError) return { ok: false, error: err.message };
    throw err;
  }
}

/**
 * One text: a compose file, Kubernetes manifests, an AsyncAPI document, a Terraform plan or state, or a format
 * that's recognised but not imported (`later`): a Helm template says how to render it, and Terraform source (or a
 * binary plan) says to run `terraform show -json`.
 */
export function importInfra(text: string, fileName: string, later?: InfraSniff, format?: FormatId): ImportOutcome {
  if (later === "helm") return { ok: false, error: HELM_TEMPLATE };
  if (later === "hcl")
    return { ok: false, error: text.startsWith("PK\u0003\u0004") ? TERRAFORM_BINARY : TERRAFORM_SOURCE };
  if (format === "terraform") return importTerraform([{ name: fileName || "plan.json", text }]);
  if (format === "asyncapi") return importAsyncApi([{ name: fileName || "asyncapi.yaml", text }]);
  if (format === "kubernetes") return importKubernetes([{ name: fileName || "manifests.yaml", text }]);
  return importCompose([{ name: fileName || "docker-compose.yml", text }]);
}

/** A .env file opened beside a compose file: read for its settings, never drawn. */
const isEnvFile = (name: string) => /(^|[\\/])\.env(\.[\w.-]+)?$|\.env$/i.test(name);

/**
 * Several files at once. They're grouped by format, and the largest group imports: a compose file with its
 * overrides (and any .env files) is one diagram, and so is a set of Kubernetes manifests, and so are several
 * AsyncAPI documents (joined on their channels). A diagram file, draw.io or Mermaid group opens its first file.
 * The rest are listed as not read.
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
  const restLines = rest.map((f) => ({
    name: f.name,
    reason:
      sniffInfra(f.text) === "helm"
        ? "a Helm template: import “helm template” output instead"
        : sniffInfra(f.text) === "hcl" || /\.tf$/i.test(f.name)
          ? "Terraform source: import “terraform show -json” output instead"
          : "not read: a different kind of file",
  }));
  if (format === "compose" || format === "asyncapi" || format === "kubernetes" || format === "terraform") {
    try {
      const outcome =
        format === "compose"
          ? importCompose(group, envFiles)
          : format === "kubernetes"
            ? importKubernetes(group)
            : format === "terraform"
              ? importTerraform(group)
              : importAsyncApi(group);
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
