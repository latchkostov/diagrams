// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

it("held discovery keeps the eager start shell clickable and skips output readiness", async () => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.doMock("./ExampleDetails", async (original) => {
    await held;
    return original();
  });
  const { StartCard } = await import("../canvas/StartCard");
  const { ExampleDiscovery } = await import("./discovery");
  const { ensureLazySurfacesLoaded } = await import("../lib/lazySurfaces");
  const { examples, exampleSummary } = await import("./index");
  const example = examples.find((e) => e.slug === "rag-assistant")!;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const onOpen = vi.fn();
  const rowId = `start-example-${example.slug}`;
  const get = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  try {
    await act(() =>
      root.render(
        <StartCard
          onBlank={vi.fn()}
          start={{
            recent: [],
            examples: [
              {
                theme: undefined,
                items: [{ slug: example.slug, title: example.title, description: exampleSummary(example) }],
              },
            ],
            onOpen,
            onOpenFile: vi.fn(),
            onPaste: vi.fn(),
            onLibrary: vi.fn(),
            onBrowseExamples: vi.fn(),
          }}
        />,
      ),
    );
    expect(ExampleDiscovery.getSnapshot().value).toBe("loading");
    const row = get(rowId)!;
    expect(row.textContent).toContain(example.title);
    expect(get(`${rowId}-thumb`)).toBeNull();
    row.focus();
    row.click();
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(example.slug);
    expect(ensureLazySurfacesLoaded()).toBeUndefined();
    await act(async () => {
      release();
      await ExampleDiscovery.ensureLoaded();
    });
    expect(get(rowId)).toBe(row);
    expect(get(`${rowId}-thumb`)).not.toBeNull();
    expect(document.activeElement).toBe(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
  } finally {
    release();
    await act(() => root.unmount());
    host.remove();
    vi.doUnmock("./ExampleDetails");
  }
});
