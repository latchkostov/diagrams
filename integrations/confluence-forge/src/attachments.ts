import { t } from "../../../src/i18n/core";
import { loadDiagram } from "../../../src/interop/embed/hostReducer";
import { contentId } from "./config";

export type ConfluenceRequest = (uri: string, options?: RequestInit) => Promise<Response>;
export interface Attachment {
  id: string;
  title: string;
}
export const MAX_FILE_BYTES = 8_000_000;

export function readDiagram(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) throw new Error(t("viewerForge.tooLarge"));
  const loaded = loadDiagram(text);
  if (!loaded.ok) throw new Error(t("viewerForge.invalid"));
  return loaded.diagram;
}

export async function listAttachments(request: ConfluenceRequest, page: string): Promise<Attachment[]> {
  const base = `/wiki/api/v2/pages/${contentId(page)}/attachments`;
  let path = `${base}?limit=100`;
  const seen = new Set<string>();
  const attachments: Attachment[] = [];
  while (path && !seen.has(path)) {
    seen.add(path);
    const response = await request(path);
    if (!response.ok) throw new Error(t("viewerForge.downloadError", { status: response.status }));
    const data = (await response.json()) as { results: Attachment[]; _links?: { next?: string } };
    for (const item of data.results) {
      if (item.title.endsWith(".livediagram.json")) attachments.push({ id: contentId(item.id), title: item.title });
    }
    // Do not follow server-supplied hosts, paths or arbitrary query parameters through the bridge.
    const next = data._links?.next;
    if (!next) break;
    const url = new URL(next, "https://confluence.invalid");
    const cursor = url.searchParams.get("cursor");
    if (url.origin !== "https://confluence.invalid" || url.pathname !== base || !cursor)
      throw new Error(t("viewerForge.bridgeError"));
    path = `${base}?limit=100&cursor=${encodeURIComponent(cursor)}`;
  }
  return attachments;
}

export async function downloadDiagram(request: ConfluenceRequest, page: string, attachment: string) {
  const response = await request(
    `/wiki/rest/api/content/${contentId(page)}/child/attachment/${contentId(attachment)}/download`,
  );
  // Bridge must return bytes after the product redirect. Never fetch a Location/downloadLink in the browser.
  if (!response.ok) throw new Error(t("viewerForge.downloadError", { status: response.status }));
  if (Number(response.headers.get("content-length")) > MAX_FILE_BYTES) throw new Error(t("viewerForge.tooLarge"));
  return readDiagram(await response.text());
}

export async function uploadDiagram(
  request: ConfluenceRequest,
  page: string,
  file: File,
  replace?: Attachment,
): Promise<Attachment> {
  if (!file.name.endsWith(".livediagram.json")) throw new Error(t("viewerForge.invalidFilename"));
  if (file.size > MAX_FILE_BYTES) throw new Error(t("viewerForge.tooLarge"));
  readDiagram(await file.text());
  const form = new FormData();
  // Keep the existing filename when replacing by ID, including when the local filename differs.
  form.append("file", file, replace?.title ?? file.name);
  form.append("minorEdit", "false");
  const base = `/wiki/rest/api/content/${contentId(page)}/child/attachment`;
  const response = await request(replace ? `${base}/${contentId(replace.id)}/data` : base, {
    method: "POST",
    headers: { "X-Atlassian-Token": "nocheck" },
    body: form,
  });
  if (!response.ok) throw new Error(t("viewerForge.uploadError", { status: response.status }));
  const data = (await response.json()) as Attachment & { results?: Attachment[] };
  const result = data.results?.[0] ?? data;
  return { id: contentId(result.id), title: result.title };
}
