/** Keep links and code as real DOM nodes; catalogs can reorder slots but never supply markup. */
export function replaceContent(element: Element, text: string, slots: Record<string, Node> = {}): void {
  element.replaceChildren(
    ...text.split(/(\uFFF0\w+\uFFF1)/).map((part) => slots[part.slice(1, -1)] ?? document.createTextNode(part)),
  );
}

export const slot = (name: string) => `\uFFF0${name}\uFFF1`;

export function find(selector: string, root: ParentNode = document): HTMLElement {
  const element = root.querySelector<HTMLElement>(selector);
  if (!element) throw new Error(`Missing static page element: ${selector}`);
  return element;
}

const element = (id: string) => find(`[data-testid="${id}"]`);

export function text(id: string, value: string): void {
  element(id).textContent = value;
}

export function content(id: string, value: string, slots: readonly string[]): void {
  const target = element(id);
  replaceContent(target, value, Object.fromEntries(slots.map((name) => [name, find(`[data-slot="${name}"]`, target)])));
}
