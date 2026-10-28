import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { NodeTooltip } from "./NodeTooltip";
import { getStencil } from "../stencils/registry";
import { stencilDescription } from "../i18n/stencilDescriptions";
import { t } from "../i18n";

it("keeps a pending catalog inside the positioned tooltip frame without English metadata", () => {
  const tip = { label: "Orders", stencil: "generic.database", rect: {} as DOMRect };
  const markup = renderToStaticMarkup(<NodeTooltip tip={tip} loading />);
  expect(markup).toContain('class="node-tip"');
  expect(markup).toContain('data-testid="node-tooltip-loading"');
  expect(markup).toContain(t("common.loading"));
  expect(markup).not.toContain(stencilDescription(getStencil(tip.stencil)));
});
