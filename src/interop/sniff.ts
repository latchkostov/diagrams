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
