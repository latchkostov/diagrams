/** A chunk's production file, or its source module on the dev server. */
export const chunk = (name: string, source: string) =>
  new RegExp(String.raw`/(?:assets/${name}-[A-Za-z0-9_-]+\.js|${source.replace(/\./g, "\\.")})(?:\?.*)?$`);
