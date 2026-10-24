import { beforeEach, expect, it, vi } from "vitest";
import type { DiagramFile } from "../model/types";
import { diagramOpenActions } from "./openDiagram";
import { clearShared, createLibraryDiagram, newDraft, setShared } from "./diagramIO";
import { newDiagramsPrivate } from "./privacyPrefs";

vi.mock("./diagramIO", () => ({
  clearShared: vi.fn(),
  createLibraryDiagram: vi.fn(() => "my-copy"),
  newDraft: vi.fn(),
  setShared: vi.fn(),
  DEVICE_PROVIDER: "device",
  DRAFT_SLUG: "new",
  SHARED_SLUG: "shared",
}));
vi.mock("./privacyPrefs", () => ({ newDiagramsPrivate: { get: vi.fn(() => true) } }));

const diagram: DiagramFile = { format: "diagrams/v1", title: "", nodes: [], edges: [], private: true };
beforeEach(() => vi.clearAllMocks());

it.each(["device", "drive"])(
  "preserves the %s target, source provenance and private-default policy before navigation",
  (providerId) => {
    const target = { providerId, ref: {}, name: "diagram.json" };
    const navigate = vi.fn(() => {
      expect(createLibraryDiagram).toHaveBeenCalledExactlyOnceWith(diagram, target, undefined, {
        sourceSlug: "source",
        private: providerId === "device",
      });
      expect(clearShared).toHaveBeenCalledOnce();
    });
    expect(diagramOpenActions("shared", navigate).openDiagram(diagram, target, "source")).toBe("my-copy");
    expect(navigate).toHaveBeenCalledExactlyOnceWith("my-copy");
    expect(newDiagramsPrivate.get).toHaveBeenCalledTimes(providerId === "device" ? 1 : 0);
  },
);

it("persists the private share import before navigating and stays put on storage failure", () => {
  const navigate = vi.fn(() => expect(setShared).toHaveBeenCalledExactlyOnceWith(diagram));
  const actions = diagramOpenActions("tutorial", navigate);
  actions.openShared(diagram);
  expect(navigate).toHaveBeenCalledExactlyOnceWith("shared");
  navigate.mockClear();
  vi.mocked(setShared).mockImplementationOnce(() => {
    throw new Error("Full");
  });
  expect(() => actions.openShared(diagram)).toThrow("Full");
  expect(navigate).not.toHaveBeenCalled();
});

it("resets and explicitly opens the draft", () => {
  const navigate = vi.fn(() => expect(newDraft).toHaveBeenCalledOnce());
  diagramOpenActions("tutorial", navigate).newDiagram();
  expect(navigate).toHaveBeenCalledExactlyOnceWith("new");
});
