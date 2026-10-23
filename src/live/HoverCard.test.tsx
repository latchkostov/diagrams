import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { HoverCard } from "./HoverCard";

vi.mock("react-dom", async (original) => ({
  ...(await original<typeof import("react-dom")>()),
  createPortal: (node: ReactNode) => node,
}));
vi.mock("@xyflow/react", () => ({ useStore: () => null }));
vi.mock("../canvas/interaction", () => ({ useInteraction: () => ({}) }));
vi.stubGlobal("document", { body: {} });

it("renders a connection imported with an unpaired surrogate in its id", () => {
  // Native import keeps any UTF-16 string as an id; encodeURIComponent would throw URIError on it.
  const id = "edge-\ud800";
  const render = () =>
    renderToStaticMarkup(
      <HoverCard
        kind="edge"
        id={id}
        name="A → B"
        type="Request"
        pinned={false}
        presenting={false}
        summary={{ problems: [], vitals: [], facts: [], sections: [] }}
        healthy="Holds a thread"
      >
        {() => null}
      </HoverCard>,
    );
  expect(render).not.toThrow();
  const markup = render();
  expect(markup).toContain('data-testid="edge-detail-edge-');
  // Opaque DOM ids: the item's id never has to be encoded into one.
  const ids = [...markup.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  expect(ids).toHaveLength(2);
  for (const domId of ids) expect(domId).not.toContain("edge-");
});
