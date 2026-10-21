import { textFieldsFixture } from "../../../src/lab/textFieldsFixture";

export interface FakeState {
  config?: Record<string, unknown>;
  status?: number;
  pageId?: string;
  body?: string;
  calls: { path: string; method: string; filename?: string }[];
  submitted?: unknown;
  closed?: boolean;
  hold?: "context" | "list" | "download";
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
    return new Promise<Response>(() => {});
  if (s.status) return new Response("Forbidden", { status: s.status });
  if (options?.method === "POST") return Response.json({ results: [{ id: "att7", title: file?.name }] });
  if (path.includes("/download")) return new Response(diagram(), { headers: { "content-type": "application/json" } });
  return Response.json({
    results: [
      { id: "7", title: "orders.livediagram.json" },
      { id: "8", title: "notes.txt" },
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
          },
        },
  theme: {
    enable: async () => {
      document.documentElement.dataset.colorMode = "dark";
    },
  },
  submit: async (payload: unknown) => {
    state().submitted = payload;
  },
  close: async () => {
    state().closed = true;
  },
};
