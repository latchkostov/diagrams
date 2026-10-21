import { t } from "../../../src/i18n/core";
import { loadDiagram } from "../../../src/interop/embed/hostReducer";
import { contentId } from "./config";

export type ConfluenceRequest = (uri: string, options?: RequestInit) => Promise<Response>;
export interface Attachment {
  id: string;
  title: string;
}
export const MAX_FILE_BYTES = 8_000_000;
export const DIAGRAM_SUFFIXES = [".diagram.json", ".livediagram.json"] as const;
export const DIAGRAM_FILE_ACCEPT = DIAGRAM_SUFFIXES.join(",");
export const isDiagramFilename = (name: string): boolean => DIAGRAM_SUFFIXES.some((suffix) => name.endsWith(suffix));

export function readDiagram(text: string) {
  checkBytes(text);
  const loaded = loadDiagram(text);
  if (!loaded.ok) throw new Error(t("viewerForge.invalid"));
  return loaded.diagram;
}

function checkBytes(text: string): void {
  if (new TextEncoder().encode(text).byteLength > MAX_FILE_BYTES) throw new Error(t("viewerForge.tooLarge"));
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
      if (isDiagramFilename(item.title)) attachments.push({ id: contentId(item.id), title: item.title });
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

/** Bound the bridge transfer before requesting bytes, then pin the checked immutable version. */
export async function downloadDiagramText(
  request: ConfluenceRequest,
  page: string,
  attachment: string,
): Promise<string> {
  page = contentId(page);
  attachment = contentId(attachment);
  const metadata = await request(`/wiki/api/v2/attachments/${attachment}`);
  if (!metadata.ok) throw new Error(t("viewerForge.downloadError", { status: metadata.status }));
  const data = (await metadata.json()) as {
    id: string;
    pageId: string;
    fileSize: number;
    version?: { number: number };
  };
  if (data.fileSize > MAX_FILE_BYTES) throw new Error(t("viewerForge.tooLarge"));
  if (
    contentId(data.id) !== attachment ||
    contentId(data.pageId) !== page ||
    !Number.isSafeInteger(data.fileSize) ||
    data.fileSize < 0 ||
    !Number.isSafeInteger(data.version?.number) ||
    data.version!.number < 1
  )
    throw new Error(t("viewerForge.bridgeError"));
  const response = await request(
    `/wiki/rest/api/content/${page}/child/attachment/${attachment}/download?version=${data.version!.number}`,
  );
  // Bridge must return bytes after the product redirect. Never fetch a Location/downloadLink in the browser.
  if (!response.ok) throw new Error(t("viewerForge.downloadError", { status: response.status }));
  if (Number(response.headers.get("content-length")) > MAX_FILE_BYTES) throw new Error(t("viewerForge.tooLarge"));
  const text = await response.text();
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > MAX_FILE_BYTES) throw new Error(t("viewerForge.tooLarge"));
  // Response.text() may strip a UTF-8 BOM; it must never exceed the checked version's size.
  if (bytes > data.fileSize) throw new Error(t("viewerForge.bridgeError"));
  return text;
}

export async function downloadDiagram(request: ConfluenceRequest, page: string, attachment: string) {
  return readDiagram(await downloadDiagramText(request, page, attachment));
}

export async function uploadDiagram(
  request: ConfluenceRequest,
  page: string,
  file: File,
  replace?: Attachment,
): Promise<Attachment> {
  if (!isDiagramFilename(file.name)) throw new Error(t("viewerForge.invalidFilename"));
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
