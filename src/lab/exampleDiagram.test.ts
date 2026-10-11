import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIAGRAM_FORMAT, type DiagramFile } from "../model/types";

const diagram = { format: DIAGRAM_FORMAT, title: "Late", nodes: [], edges: [] } as unknown as DiagramFile;
const loaded = new Map<string, DiagramFile>();
const loadExample = vi.fn<(slug: string) => Promise<DiagramFile>>();

vi.mock("../examples", () => ({
  getLoadedExample: (slug: string) => loaded.get(slug),
  loadExample: (slug: string) => loadExample(slug),
}));
vi.mock("../interop/ui/toast", () => ({ notify: vi.fn() }));

const { exampleDiagram, resetExampleResource, ExampleLoadError } = await import("./exampleDiagram");

/** What exampleDiagram throws (a promise while loading, an error after a failure). */
function thrown(slug: string): unknown {
  try {
    exampleDiagram(slug);
  } catch (value) {
    return value;
  }
  throw new Error("exampleDiagram returned instead of suspending");
}

describe("exampleDiagram", () => {
  beforeEach(() => {
    loaded.clear();
    loadExample.mockReset();
  });

  it("keeps a failed download until Retry resets it, then downloads again", async () => {
    loadExample.mockRejectedValueOnce(new Error("offline"));
    await thrown("flaky");
    const failure = thrown("flaky");
    expect(failure).toBeInstanceOf(ExampleLoadError);
    expect(failure).toMatchObject({ slug: "flaky" });
    // Rendering again without a reset shows the error; it doesn't loop on the network.
    expect(thrown("flaky")).toBe(failure);
    expect(loadExample).toHaveBeenCalledTimes(1);

    loadExample.mockImplementationOnce(async (slug) => {
      loaded.set(slug, diagram);
      return diagram;
    });
    resetExampleResource("flaky");
    const retry = thrown("flaky");
    expect(retry).toBeInstanceOf(Promise);
    await retry;
    expect(loadExample).toHaveBeenCalledTimes(2);
    expect(exampleDiagram("flaky")).toBe(diagram);
  });

  it("shares one request while a download is pending", async () => {
    let finish!: () => void;
    loadExample.mockImplementationOnce(
      (slug) =>
        new Promise((resolve) => {
          finish = () => {
            loaded.set(slug, diagram);
            resolve(diagram);
          };
        }),
    );
    const first = thrown("shared");
    expect(thrown("shared")).toBe(first);
    finish();
    await first;
    expect(loadExample).toHaveBeenCalledTimes(1);
    expect(exampleDiagram("shared")).toBe(diagram);
  });
});
