/** Keep links and code as real DOM nodes; catalogs can reorder slots but never supply markup. */
export function replaceContent(element: Element, text: string, slots: Record<string, Node> = {}): void {
  element.replaceChildren(
    ...text.split(/(\uFFF0\w+\uFFF1)/).map((part) => slots[part.slice(1, -1)] ?? document.createTextNode(part)),
  );
}

export const slot = (name: string) => `\uFFF0${name}\uFFF1`;

export const find = (selector: string) => document.querySelector<HTMLElement>(selector)!;
