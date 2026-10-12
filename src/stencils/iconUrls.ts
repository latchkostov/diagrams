// The stencil icons' URLs, keyed "./icons/<icon>.svg": the bundled files. The exported HTML viewer swaps this
// module for its own (src/export/viewer/iconUrls.ts), which reads the few icons its file carries as data URIs.
export const iconUrls = import.meta.glob("./icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;
