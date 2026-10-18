/** Keep script transcripts independent of checkout and temporary-directory placement. */
export function normalizeScriptOutput(text: string, root: string, temporary?: string): string {
  let clean = text.replaceAll("\\", "/").replaceAll("\r\n", "\n");
  if (temporary) clean = clean.split(temporary.replaceAll("\\", "/")).join("<tmp>");
  return clean.split(root.replaceAll("\\", "/")).join("<repo>");
}
