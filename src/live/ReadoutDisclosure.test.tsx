// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ReadoutDisclosure } from "./ReadoutDisclosure";
import { Disclosure } from "../canvas/inspector/Disclosure";

it("lays out a Live disclosure body with only the shared readout stylesheet", () => {
  const style = document.createElement("style");
  style.textContent = readFileSync("src/styles/readout.css", "utf8");
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <ReadoutDisclosure title="Details" testId="live-details" open>
      <p>First fact</p>
      <p>Second fact</p>
    </ReadoutDisclosure>,
  );
  document.head.append(style);
  document.body.append(container);
  try {
    const body = container.querySelector<HTMLElement>('[data-testid="live-details-body"]')!;
    const layout = getComputedStyle(body);
    expect(layout.display).toBe("flex");
    expect(layout.flexDirection).toBe("column");
    expect(layout.gap).toBe("0");
  } finally {
    container.remove();
    style.remove();
  }
});

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
  expect(html).toContain('class="readout-disclosure-body" data-testid="advanced-body"');
  expect(html).not.toContain("insp-section-body");
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
