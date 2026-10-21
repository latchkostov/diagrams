import { textFieldsFixture } from "../../../src/lab/textFieldsFixture";
import type { ModalOptions } from "@forge/bridge";

export interface FakeState {
  config?: Record<string, unknown>;
  status?: number;
  fileSize?: number;
  parseCount?: number;
  submitError?: boolean;
  longFilename?: boolean;
  uploaded?: { id: string; title: string; body: string };
  pageId?: string;
  body?: string;
  calls: { path: string; method: string; filename?: string }[];
  submitted?: unknown;
  closed?: boolean;
  modal?: { pageId?: unknown; config?: unknown };
  modalOptions?: ModalOptions;
  modalError?: boolean;
  modalClosed?: boolean;
  closeModal?: () => void;
  documentHeights?: number[];
  hold?: "context" | "list" | "download";
  release?: () => void;
}
declare global {
  interface Window {
    __forgeTest: FakeState;
  }
}
const state = () => (window.__forgeTest ??= { calls: [] });
const diagram = () =>
  state().body ??
  JSON.stringify({
    ...textFieldsFixture,
    simulations: [{ id: "flow", title: "Order flow", durationMs: 60_000, traffic: [] }],
  });

export const requestConfluence = async (path: string, options?: RequestInit) => {
  const s = state();
  const file = options?.body instanceof FormData ? (options.body.get("file") as File) : undefined;
  s.calls.push({ path, method: options?.method ?? "GET", ...(file ? { filename: file.name } : {}) });
  if ((s.hold === "list" && !path.includes("/download")) || (s.hold === "download" && path.includes("/download")))
    await new Promise<void>((resolve) => {
      s.release = resolve;
    });
  if (s.status) return new Response("Forbidden", { status: s.status });
  if (options?.method === "POST" && file) {
    const id = path.endsWith("/7/data") ? "7" : "9";
    s.uploaded = { id, title: file.name, body: await file.text() };
    return Response.json({ results: [{ id: `att${id}`, title: file.name }] });
  }
  const id = path.match(/attachment(?:s)?\/(\d+)/)?.[1] ?? "7";
  const body = s.uploaded?.id === id ? s.uploaded.body : diagram();
  if (path.startsWith("/wiki/api/v2/attachments/"))
    return Response.json({
      id,
      pageId: "42",
      fileSize: s.fileSize ?? new TextEncoder().encode(body).byteLength,
      version: { number: 3 },
    });
  if (path.includes("/download")) return new Response(body, { headers: { "content-type": "application/json" } });
  return Response.json({
    results: [
      {
        id: "7",
        title: s.longFilename ? "a-very-long-attachment-name-".repeat(8) + ".diagram.json" : "orders.diagram.json",
      },
      ...(s.uploaded ? [s.uploaded] : []),
      { id: "8", title: "notes.txt" },
      { id: "10", title: "older.livediagram.json" },
      { id: "11", title: "settings.json" },
    ],
    _links: {},
  });
};
export const view = {
  getContext: async () =>
    state().hold === "context"
      ? new Promise<never>(() => {})
      : {
          extension: {
            content: { id: state().pageId ?? "42" },
            config: state().config ?? { attachmentId: "7", simulation: "", height: 0, theme: "auto" },
            modal: state().modal,
          },
        },
  theme: {
    enable: async () => {
      document.documentElement.dataset.colorMode = "dark";
    },
  },
  submit: async (payload: unknown) => {
    if (state().submitError) throw new Error("Save failed");
    state().submitted = payload;
  },
  close: async () => {
    state().closed = true;
  },
};

export class Modal {
  constructor(private options: ModalOptions) {}
  async open() {
    if (state().modalError) throw new Error("Modal unavailable");
    state().modalOptions = this.options;
    state().closeModal = () => {
      state().modalClosed = true;
      this.options.onClose?.(undefined);
    };
  }
}

// Emulate Forge's host-provided automatic iframe resizer, not an API in @forge/bridge.
// The host observes document content, then changes the iframe viewport to match.
const observer = new ResizeObserver(() => {
  const height = Math.ceil(document.body.getBoundingClientRect().height);
  (state().documentHeights ??= []).push(height);
  const frame = window.frameElement;
  // frameElement belongs to the parent realm, so instanceof this window's HTMLIFrameElement is false.
  if (frame?.tagName === "IFRAME" && (frame as HTMLIFrameElement).style.height !== `${height}px`)
    (frame as HTMLIFrameElement).style.height = `${height}px`;
});
observer.observe(document.body);
window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
