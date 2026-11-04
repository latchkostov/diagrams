import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NodeSettings } from "./lazyNodeSettings";

it("shows Simulation loading feedback before the parent settings catalog arrives", () => {
  // No downloaded settings render yet, so the shell must not need any editor props.
  const html = renderToStaticMarkup(<NodeSettings {...({} as ComponentProps<typeof NodeSettings>)} />);
  expect(html).toContain('data-testid="inspector.node-settings-loading"');
  expect(html).toContain('data-testid="inspector.simulation-loading"');
  expect(html).toContain('role="status"');
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("Loading");
});
