import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { messageTypesFixture } from "../../lab/messageTypesFixture";
import type { EditorApi } from "../../editor/types";
import type { DiagramFile } from "../../model/types";
import { EdgeMessages, NodeMessages } from "./MessageFields";
import { cachedMessageTypesAt } from "../../model/messageTypes";

// These are markup/choice-budget tests; asynchronous scheduling has its own reader and render-path regressions.
vi.mock("./useMessageTypes", () => ({
  useMessageTypes: (d: DiagramFile) => ({ types: cachedMessageTypesAt(d), updating: false }),
}));

vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useLayoutEffect: () => {},
}));

const editor = (d: DiagramFile) => ({ getDiagram: () => d }) as unknown as EditorApi;
const count = (html: string, testId: string) => html.split(`data-testid="${testId}`).length - 1;

it("renders an imported rename map a page at a time, with bounded choices", () => {
  const d = messageTypesFixture();
  // 2,000 rules over a 2,000-type vocabulary: every rule's pickers would list the whole vocabulary.
  const types = Array.from({ length: 2_000 }, (_, i) => `T${i}`);
  d.nodes[1].props = { emits: Object.fromEntries(types.map((type) => [type, `${type}Out`])) };
  d.nodes[0].props = { messageType: "Send" };
  const html = renderToStaticMarkup(<NodeMessages nodeId="api" editor={editor(d)} source={false} />);
  expect(count(html, "inspector-emits-row-")).toBe(25);
  expect(html).toContain('data-testid="inspector-emits-more"');
  expect(html).toContain("+25 more");
  expect(html.length).toBeLessThan(200_000);
});

it("caps the chips a filter lists and says how many more exist", () => {
  const d = messageTypesFixture();
  d.nodes.push(
    ...Array.from({ length: 300 }, (_, i) => ({
      id: `s${i}`,
      stencil: "client.browser",
      label: `S${i}`,
      x: 0,
      y: 0,
      props: { messageType: `Type${i}` },
    })),
  );
  d.edges.push(...Array.from({ length: 300 }, (_, i) => ({ id: `in${i}`, from: `s${i}`, to: "api" })));
  const html = renderToStaticMarkup(<EdgeMessages edgeId="send" editor={editor(d)} />);
  expect(count(html, "inspector-filter-option-")).toBe(100);
  expect(html).toContain('data-testid="inspector-filter-more"');
  expect(html).toContain("+202 more");
  // Carries still lists every type that passes: the inspector reads the full analysis.
  expect(html).toContain("Type299");
});

it("keeps every selected filter type listed and pressed past the choice limit", () => {
  const d = messageTypesFixture();
  d.nodes.push(
    ...Array.from({ length: 300 }, (_, i) => ({
      id: `s${i}`,
      stencil: "client.browser",
      label: `S${i}`,
      x: 0,
      y: 0,
      props: { messageType: `Type${i}` },
    })),
  );
  d.edges.push(...Array.from({ length: 300 }, (_, i) => ({ id: `in${i}`, from: `s${i}`, to: "api" })));
  d.edges[1].props = { filter: ["Type299", "Custom"] };
  const html = renderToStaticMarkup(<EdgeMessages edgeId="send" editor={editor(d)} />);
  expect(count(html, "inspector-filter-option-")).toBe(102);
  expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="inspector-filter-option-0"[^>]*>Type299</);
  expect(html).toMatch(/aria-pressed="true"[^>]*data-testid="inspector-filter-option-1"[^>]*>Custom</);
});

it("renders at most 100 selected chips of a 30,000-entry imported filter, with a bulk clear", () => {
  const d = messageTypesFixture();
  d.edges[1].props = { filter: Array.from({ length: 30_000 }, (_, i) => `F${i}`) };
  const html = renderToStaticMarkup(<EdgeMessages edgeId="send" editor={editor(d)} />);
  // 100 selected chips first, then the one unselected upstream type (Send).
  expect(count(html, "inspector-filter-option-")).toBe(101);
  expect(html.split('aria-pressed="true"').length - 1).toBe(100);
  expect(html).toContain("+29,900 selected");
  expect(html).toContain('data-testid="inspector-filter-clear-all"');
});
