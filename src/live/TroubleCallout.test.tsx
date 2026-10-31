import { renderToStaticMarkup } from "react-dom/server";
// @vitest-environment happy-dom
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { expect, it, vi } from "vitest";
import { TroubleCallout } from "./TroubleCallout";
import { BottleneckCallout } from "./BottleneckCallout";

it("the consumer tutorial target stays inside the existing action button", () => {
  const html = renderToStaticMarkup(
    <TroubleCallout
      trouble={{
        key: "lag:orders",
        kind: "lag",
        node: "orders",
        headline: "Orders lag is rising",
        announce: "Orders lag is rising",
        detail: "Add another consumer to drain orders.",
        action: { kind: "add-consumer", node: "orders" },
      }}
      onAction={() => {}}
      onDismiss={() => {}}
    />,
  );
  expect(html).toMatch(
    /<button[^>]*data-testid="trouble-action"[^>]*data-action="add-consumer"[^>]*>.*<span data-testid="trouble-add-consumer">Add a consumer<\/span><\/button>/,
  );
  expect(html).toContain("Add a consumer");
});

it("clicking the consumer alias activates the existing action", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const action = vi.fn();
  try {
    flushSync(() =>
      root.render(
        <TroubleCallout
          trouble={{
            key: "lag:orders",
            kind: "lag",
            node: "orders",
            headline: "Orders lag is rising",
            announce: "Orders lag is rising",
            detail: "Messages wait for a reader.",
            action: { kind: "add-consumer", node: "orders" },
          }}
          onAction={action}
          onDismiss={() => {}}
        />,
      ),
    );
    const target = host.querySelector<HTMLElement>('[data-testid="trouble-add-consumer"]');
    expect(target).not.toBeNull();
    target!.click();
    expect(action).toHaveBeenCalledWith(
      { kind: "add-consumer", node: "orders" },
      "Add a consumer",
      expect.any(Function),
    );
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});

it("the consumer tutorial action works when capacity replaces the Trouble callout", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const addConsumer = vi.fn();
  try {
    flushSync(() =>
      root.render(
        <BottleneckCallout
          view={{
            nodes: {},
            tone: "warn",
            headline: "Nobody reads Orders",
            detail: "Messages wait for a reader.",
            fix: null,
            addConsumer: "orders",
            converged: true,
          }}
          onAddConsumer={addConsumer}
        />,
      ),
    );
    const target = host.querySelector<HTMLElement>('[data-testid="trouble-add-consumer"]');
    expect(target).not.toBeNull();
    target!.click();
    expect(addConsumer).toHaveBeenCalledExactlyOnceWith("orders");
  } finally {
    flushSync(() => root.unmount());
    host.remove();
  }
});

it("a floating status strip uses no obstacle placement or inline translation", () => {
  const html = renderToStaticMarkup(
    <TroubleCallout
      floating
      onDismiss={() => {}}
      trouble={{
        key: "lag:orders",
        kind: "lag",
        node: "orders",
        headline: "Orders lag is rising",
        announce: "Orders lag is rising",
        detail: "Messages wait for a reader.",
        action: { kind: "events", node: "orders" },
      }}
    />,
  );
  expect(html).toContain("is-status-strip");
  expect(html).not.toContain("style=");
});
