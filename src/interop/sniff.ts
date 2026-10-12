// Quick format sniffs, apart from the readers: recognising a file doesn't load its importer.

/** Does this text look like draw.io / mxGraph XML? */
export function looksLikeDrawio(text: string): boolean {
  const head = text.slice(0, 4000).trimStart();
  return (
    /^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<(mxfile|mxGraphModel)\b/.test(head) ||
    (/^(<\?xml[^>]*>\s*)?<svg\b/.test(head) && /content="[^"]*(mxfile|mxGraphModel)/.test(text.slice(0, 200000)))
  );
}

/** Does this text look like a Mermaid flowchart? */
export function looksLikeMermaid(text: string): boolean {
  const body = text.replace(/^\uFEFF/, "").replace(/^\s*---\r?\n[\s\S]*?\r?\n---\s*\r?\n/, "");
  const first = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("%%"));
  return !!first && /^(flowchart|graph)\b/i.test(first);
}

/**
 * Infrastructure and spec files (docs/research/imports.md): cheap checks on the first 4,000 characters, so
 * recognising one never loads the YAML reader.
 */
export type InfraSniff = "helm" | "asyncapi" | "kubernetes" | "compose" | "terraform";

export function sniffInfra(text: string): InfraSniff | undefined {
  const head = text.slice(0, 4000);
  // JSON first: a diagram file (or anything else in JSON) that mentions Helm or AsyncAPI in its text stays itself.
  if (/^\s*\{/.test(head)) {
    if (/"format"\s*:\s*"diagrams\//.test(head)) return undefined;
    return /^\s*\{\s*"asyncapi"\s*:\s*"[23]\./.test(head)
      ? "asyncapi"
      : /"format_version"/.test(head) && /"terraform_version"/.test(head)
        ? "terraform"
        : // kubectl's JSON output starts with its apiVersion.
          /^\s*\{\s*"apiVersion"\s*:/.test(head) && /"kind"\s*:/.test(head)
          ? "kubernetes"
          : undefined;
  }
  if (/^asyncapi:\s*['"]?[23]\./m.test(head)) return "asyncapi";
  if (/^apiVersion:/m.test(head) && /^kind:/m.test(head))
    // Only a Kubernetes manifest can be a Helm template.
    return /\{\{-?\s*(\.Values|\.Release|\.Chart|include ")/.test(head) ? "helm" : "kubernetes";
  if (/^services:/m.test(head)) return "compose";
  return undefined;
}
