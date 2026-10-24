import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReadoutDisclosure } from "./ReadoutDisclosure";
import { Disclosure } from "../canvas/inspector/Disclosure";

it("puts the collapsed native readout description inside summary, outside the hidden body", () => {
  const html = renderToStaticMarkup(
    <ReadoutDisclosure title="Advanced" testId="advanced" summary="4 replicas">
      <p>Controls</p>
    </ReadoutDisclosure>,
  );
  const head = html.slice(html.indexOf("<summary"), html.indexOf("</summary>"));
  expect(head).toContain('data-testid="advanced-summary"');
  expect(head).toContain('aria-hidden="true"');
  expect(head).toContain("4 replicas");
  const id = /aria-describedby="([^"]+)"/.exec(head)![1];
  expect(head).toContain(`id="${id}"`);
});

it("puts the collapsed inspector description inside the band button without changing its name", () => {
  const html = renderToStaticMarkup(
    <Disclosure id="test-band" title="Simulation" summary="4 replicas">
      <p>Controls</p>
    </Disclosure>,
  );
  const head = html.slice(html.indexOf("<button"), html.indexOf("</button>"));
  expect(head).toContain('data-testid="inspector-summary-test-band"');
  expect(head).toContain('aria-hidden="true"');
  expect(head).toContain("4 replicas");
  expect(html).not.toContain("Controls");
});
