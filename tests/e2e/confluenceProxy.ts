/** The macro fixture may proxy assets only from its configured production server. */
export async function fetchConfluenceViewer(target: string, baseURL: string): Promise<Response> {
  const url = new URL(target, baseURL);
  if (url.origin !== new URL(baseURL).origin) throw new Error("Viewer proxy origin mismatch");
  return fetch(url, { redirect: "error" });
}
