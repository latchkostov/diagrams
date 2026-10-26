/** These controls must remain actionable beside a hover card. */
export const protectedControls =
  '[data-canvas-overlay], .lv-note[data-waiting], [data-testid="live-controls"], [data-testid="live-toggle"], [data-testid="inspector"]';

/** Watch control roots, not their animated descendants (such as timeline progress). */
export function observeProtectedControls(wrap: Element, place: () => void): () => void {
  const roots = new Set<Element>();
  const sizes = new ResizeObserver(place);
  const visibility = new MutationObserver(place);
  const sync = () => {
    const next = new Set(wrap.querySelectorAll(protectedControls));
    const changed = next.size !== roots.size || [...next].some((el) => !roots.has(el));
    if (!changed) return;
    sizes.disconnect();
    visibility.disconnect();
    roots.clear();
    for (const el of next) {
      roots.add(el);
      sizes.observe(el);
      visibility.observe(el, { attributes: true, attributeFilter: ["style", "class", "hidden"] });
    }
    place();
  };
  sync();
  const membership = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          (record.type === "attributes" &&
            (record.attributeName === "data-canvas-overlay" ||
              (record.target instanceof Element && record.target.matches(".lv-note")))) ||
          [...record.addedNodes, ...record.removedNodes].some(
            (node) =>
              node instanceof Element && (node.matches(protectedControls) || !!node.querySelector(protectedControls)),
          ),
      )
    )
      sync();
  });
  membership.observe(wrap, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-waiting", "data-canvas-overlay"],
  });
  return () => {
    sizes.disconnect();
    visibility.disconnect();
    membership.disconnect();
  };
}
