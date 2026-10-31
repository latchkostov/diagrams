// @vitest-environment happy-dom
import { act, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi } from "vitest";
import { routingIntent } from "../editor/routingIntent";
import { RouteTableFields, TrafficMixFields } from "./RoutingFields";
import { routingFixture } from "../lab/routingFixture";
import type { EditorApi } from "../editor/types";
vi.mock("../i18n", async (original) => ({ ...(await original<typeof import("../i18n")>()), useLocale: () => "en" }));
for (const [Fields, nodeId, intent, testId] of [
  [RouteTableFields, "kong", "default", "routes-default-details"],
  [TrafficMixFields, "app", "new-route", "mix-new-route-path"],
] as const) {
  it(`an earlier ${intent} field mount cannot erase a newer routing request`, async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const d = routingFixture();
    const node = d.nodes.find((n) => n.id === nodeId)!;
    const editor = { getDiagram: () => d } as EditorApi;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    routingIntent.clear(nodeId, routingIntent.serial(nodeId));
    function NextRequest() {
      useLayoutEffect(() => routingIntent.set(nodeId, intent), []);
      return null;
    }
    const fields = (key: number) => (
      <Fields
        key={key}
        editor={editor}
        nodeId={nodeId}
        props={Fields === TrafficMixFields ? {} : (node.props ?? {})}
        planning={d.planning}
      />
    );
    try {
      await act(() =>
        root.render(
          <>
            {fields(0)}
            <NextRequest />
          </>,
        ),
      );
      expect(routingIntent.peek(nodeId)).toEqual(intent);
      await act(() => root.render(fields(1)));
      expect(host.querySelector(`[data-testid="${testId}"]`)).not.toBeNull();
      expect(routingIntent.peek(nodeId)).toBeUndefined();
    } finally {
      await act(() => root.unmount());
      host.remove();
      routingIntent.clear(nodeId, routingIntent.serial(nodeId));
      vi.unstubAllGlobals();
    }
  });
}
