/** Resource capabilities differ from hyperlink schemes and from the offline viewer. */
export function markdownImageSource(src: string, offline: boolean, origin?: string): string | undefined {
  const value = src.trim();
  if (/^data:image\//i.test(value) || /^blob:/i.test(value)) return value;
  if (offline || !origin) return undefined;
  try {
    const url = new URL(value, origin);
    if ((url.protocol === "http:" || url.protocol === "https:") && url.origin === origin) return url.href;
  } catch {
    /* An invalid source is displayed as its alt text. */
  }
  return undefined;
}
