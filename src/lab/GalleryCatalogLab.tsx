import { useRef, useState } from "react";
import { TopBar } from "../components/TopBar";
import { ExamplesDialog } from "../components/ExamplesDialog";
import { examples, type Example } from "../examples";
import { diagramThumb } from "../lib/thumbnail";
import { useInterop } from "../interop/useInterop";
import type { CanvasHandle } from "../canvas/CanvasView";

const local: Example = {
  slug: "synthetic-local",
  title: "Synthetic local scenario",
  localOnly: true,
  diagram: { format: "diagrams/v1", title: "Synthetic local scenario", nodes: [], edges: [] },
  thumb: diagramThumb({ nodes: [], edges: [] }),
};
const catalog = [...examples.filter((e) => !e.localOnly), local];

/** Exercises the development catalog on the production test build, using invented data only. */
export function GalleryCatalogLab() {
  const [open, setOpen] = useState(false);
  const canvas = useRef<CanvasHandle | null>(null);
  const interop = useInterop({
    view: "canvas",
    slug: "new",
    canvas,
    openDiagram: () => undefined,
    openShared: () => {},
    isPublicExample: () => false,
  });
  return (
    <div data-testid="gallery-catalog-fixture">
      <TopBar
        view="canvas"
        onView={() => {}}
        example="new"
        exampleOptions={[
          { slug: "new", title: "Draft", group: "yours" },
          ...catalog.map((e) => ({ slug: e.slug, title: e.title, group: "examples" as const, localOnly: e.localOnly })),
        ]}
        onExample={() => {}}
        onBrowseExamples={() => setOpen(true)}
        interop={interop}
        onPresent={() => {}}
        onNewDiagram={() => {}}
        onLibrary={() => {}}
        libraryCount={0}
      />
      {open && <ExamplesDialog catalog={catalog} onClose={() => setOpen(false)} onOpen={() => setOpen(false)} />}
    </div>
  );
}
