// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { FALLBACK_STENCIL, getStencil } from "../stencils/registry";
import { iconUrl } from "../stencils/iconUrls";
import { StencilIcon } from "./StencilIcon";

class Observer {
  static instances: Observer[] = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(readonly callback: IntersectionObserverCallback) {
    Observer.instances.push(this);
  }
  show(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  Observer.instances = [];
  vi.unstubAllGlobals();
});

function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("IntersectionObserver", Observer);
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  return container;
}

it("canvas artwork stays eager without constructing a catalog observer", async () => {
  const container = setup();
  await act(() => root?.render(<StencilIcon stencil={FALLBACK_STENCIL} />));
  expect(container.firstElementChild?.getAttribute("src")).toBe(iconUrl(FALLBACK_STENCIL.icon));
  expect(Observer.instances).toHaveLength(0);
});

it("catalog artwork shares visibility observation and releases offscreen images on unmount", async () => {
  const container = setup();
  await act(() =>
    root?.render(
      <>
        <StencilIcon stencil={FALLBACK_STENCIL} loading="lazy" />
        <StencilIcon stencil={getStencil("client.browser")} loading="lazy" />
      </>,
    ),
  );
  const [first, second] = Array.from(container.children);
  expect(first.getAttribute("src")).toBeNull();
  expect(second.getAttribute("src")).toBeNull();
  expect(Observer.instances).toHaveLength(1);
  const observer = Observer.instances[0];
  observer.show(first);
  expect(first.getAttribute("src")).toBe(iconUrl(FALLBACK_STENCIL.icon));
  expect(second.getAttribute("src")).toBeNull();
  await act(() => root?.unmount());
  root = undefined;
  expect(observer.disconnect).toHaveBeenCalledOnce();
  observer.show(second);
  expect(second.getAttribute("src")).toBeNull();
});

it("a queued visibility callback cannot fetch a replaced icon's source", async () => {
  const container = setup();
  await act(() => root?.render(<StencilIcon stencil={FALLBACK_STENCIL} loading="lazy" />));
  const image = container.firstElementChild;
  expect(image).not.toBeNull();
  if (!image) throw new Error("Expected stencil artwork");
  const old = Observer.instances[0];
  const browser = getStencil("client.browser");
  await act(() => root?.render(<StencilIcon stencil={browser} loading="lazy" />));
  const current = Observer.instances[1];
  old.show(image);
  expect(image.getAttribute("src")).toBeNull();
  current.show(image);
  expect(image.getAttribute("src")).toBe(iconUrl(browser.icon));
});
