// @vitest-environment happy-dom
import { act, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { cancelObservedWork, observationPorts } from "../lib/observations";
import { svgToPng } from "../interop/image";
import { SequenceDialog } from "./SequenceDialog";
import { toast } from "../interop/ui/toast";

const context = vi.hoisted(() => {
  const source = { documentId: "sequence-source", identity: {} };
  return { source, current: source };
});
vi.mock("../palette/observationSource", () => ({ currentObservationSource: () => context.current }));
vi.mock("../interop/image", () => ({ svgToPng: vi.fn() }));
vi.mock("../interop/ui/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../interop/ui/Dialog", () => ({
  Dialog: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
vi.mock("../trace/svg", () => ({
  SEQUENCE_THEMES: { light: {} },
  toSvg: () => ({ svg: "<svg/>", header: "", width: 100, height: 100, headerHeight: 0, bandTop: 0 }),
}));

afterEach(() => {
  cancelObservedWork(context.source);
  context.current = context.source;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

for (const cancelled of [false, true])
  it(`sequence PNG captures ownership before conversion${cancelled ? " and honours explicit cancellation" : " across navigation"}`, async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sequence");
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    let release!: (value: string) => void;
    vi.mocked(svgToPng).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const listener = vi.fn();
    const stop = observationPorts.exports.subscribe(listener);
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(() =>
        root.render(
          <StrictMode>
            <SequenceDialog
              diagram={{ format: "diagrams/v1", title: "Public sequence", nodes: [], edges: [] }}
              trace={{
                rootId: 1,
                type: "Request",
                origin: "source",
                startedAt: 0,
                done: true,
                partial: false,
                truncated: false,
                steps: [],
              }}
              theme="light"
              onClose={() => {}}
            />
          </StrictMode>,
        ),
      );
      await act(() => host.querySelector<HTMLButtonElement>('[data-testid="sequence-download-png"]')!.click());
      expect(svgToPng).toHaveBeenCalledOnce();
      if (cancelled) cancelObservedWork(context.source);
      context.current = { documentId: "another-document", identity: {} };
      await act(async () => {
        release("data:image/png;base64,cG5n");
      });
      if (cancelled) {
        expect(click).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
      } else {
        expect(click).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith({ ...context.source, format: "png", bytes: 3 });
      }
    } finally {
      await act(() => root.unmount());
      host.remove();
      stop();
    }
  });

it("an old download Retry cannot export after a different trace replaces its dialog", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => {});
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sequence");
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementationOnce(() => {
    throw new Error("Download refused");
  });
  const listener = vi.fn();
  const stop = observationPorts.sequenceExport.subscribe(listener);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const dialog = (rootId: number) => (
    <StrictMode>
      <SequenceDialog
        diagram={{ format: "diagrams/v1", title: "Public sequence", nodes: [], edges: [] }}
        trace={{
          rootId,
          type: "Request",
          origin: "source",
          startedAt: 0,
          done: true,
          partial: false,
          truncated: false,
          steps: [],
        }}
        theme="light"
        onClose={() => {}}
      />
    </StrictMode>
  );
  try {
    await act(() => root.render(dialog(17)));
    await act(() => host.querySelector<HTMLButtonElement>('[data-testid="sequence-download-svg"]')!.click());
    expect(click).toHaveBeenCalledOnce();
    const retry = vi.mocked(toast.error).mock.calls.at(-1)?.[1]?.action?.run;
    expect(retry).toBeTypeOf("function");
    if (!retry) throw new Error("Expected download Retry");
    await act(() => root.render(dialog(18)));
    click.mockClear().mockImplementation(() => {});
    await act(async () => retry());
    expect(click).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  } finally {
    await act(() => root.unmount());
    host.remove();
    stop();
  }
});
