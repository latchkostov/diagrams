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
export type InfraSniff = "helm" | "asyncapi" | "kubernetes" | "compose" | "terraform" | "hcl";

export function sniffInfra(text: string): InfraSniff | undefined {
  const head = text.slice(0, 4000);
  // JSON first: a diagram file (or anything else in JSON) that mentions Helm or AsyncAPI in its text stays itself.
  if (/^\s*\{/.test(head)) {
    if (/"format"\s*:\s*"diagrams\//.test(head)) return undefined;
    if (/^\s*\{\s*"asyncapi"\s*:\s*"[23]\./.test(head)) return "asyncapi";
    // Terraform and Kubernetes JSON: their keys in any order, anywhere in the text (linear scans). A plan that
    // manages Kubernetes objects mentions apiVersion and kind too; its root_module says it's Terraform.
    const tf = /"terraform_version"\s*:\s*"/.test(text) && /"(?:format_version|lineage)"\s*:/.test(text);
    const k8s = /"apiVersion"\s*:\s*"/.test(text) && /"kind"\s*:\s*"/.test(text);
    return tf && (!k8s || /"(?:root_module|lineage)"\s*:/.test(text)) ? "terraform" : k8s ? "kubernetes" : undefined;
  }
  if (/^asyncapi:\s*['"]?[23]\./m.test(head)) return "asyncapi";
  if (/^apiVersion:/m.test(head) && /^kind:/m.test(head))
    // Only a Kubernetes manifest can be a Helm template.
    return /\{\{-?\s*(\.Values|\.Release|\.Chart|include ")/.test(head) ? "helm" : "kubernetes";
  if (/^services:/m.test(head)) return "compose";
  // A binary plan file (a zip) or Terraform source: recognised, to say what to run instead.
  if (
    head.startsWith("PK\u0003\u0004") ||
    /^(?:(?:resource|data|module|provider|variable|output)(?: +"[\w-]+")+|terraform|locals) *\{/m.test(head)
  )
    return "hcl";
  return undefined;
}
