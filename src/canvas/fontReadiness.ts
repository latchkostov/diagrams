import { readyFonts } from "./fonts";

/** Cache the expensive face/element scan for a canvas. Text is read natively once per
 * request; controlled renderer inputs cover typography changes without retaining a DOM
 * observer during idle/live frames. Position-only commits keep those inputs identical. */
export function createFontReadiness() {
  let root: HTMLElement | undefined;
  let text: string | null | undefined;
  let inputs: readonly unknown[] = [];
  let loaded: Promise<void> | undefined;
  return {
    invalidate() {
      loaded = undefined;
    },
    ready(el: HTMLElement, typography: readonly unknown[] = []) {
      const currentText = el.textContent;
      if (
        root !== el ||
        text !== currentText ||
        inputs.length !== typography.length ||
        typography.some((v, i) => v !== inputs[i])
      ) {
        root = el;
        text = currentText;
        inputs = typography;
        loaded = undefined;
      }
      return (loaded ??= readyFonts(el));
    },
  };
}
