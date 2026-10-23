import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { messageTypesFixture } from "../../lab/messageTypesFixture";
import type { EditorApi } from "../../editor/types";
import type { DiagramFile } from "../../model/types";
import { EdgeMessages, NodeMessages } from "./MessageFields";

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
