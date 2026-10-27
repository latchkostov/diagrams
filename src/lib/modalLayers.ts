// The open modal surfaces, oldest first: dialogs, the command palette, the inject frame, the shortcuts sheet and the
// colour picker. Each registers where it makes the page behind it inert, and leaves with the same cleanup, so this
// stack is the one answer to "is a modal open, and which is on top". The toasts read it: ordinary notifications step
// back while any modal is open, and a dialog's own feedback is shown in that dialog's feedback slot.

export interface ModalLayer {
  readonly id: number;
  /** The modal's panel (its role="dialog" element): it owns the keyboard inside the layer. */
  readonly panel: HTMLElement;
  /** Where the modal's own feedback renders, inside its panel; null when it has no slot. */
  readonly feedback: HTMLElement | null;
  /** What had the keyboard as it opened: where it hands the focus back when it closes. */
  readonly opener: Element | null;
}

let stack: readonly ModalLayer[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Registers an open modal; remove it only after restoring background inertness and returning focus. */
export function openModalLayer(
  panel: HTMLElement,
  { feedback = null, opener = null }: { feedback?: HTMLElement | null; opener?: Element | null } = {},
): () => void {
  const layer: ModalLayer = { id: ++seq, panel, feedback, opener };
  stack = [...stack, layer];
  emit();
  return () => {
    if (!stack.includes(layer)) return;
    stack = stack.filter((l) => l !== layer);
    emit();
  };
}

export const modalLayers = {
  /** The topmost open modal, if any. */
  get top(): ModalLayer | null {
    return stack.at(-1) ?? null;
  },
  get stack() {
    return stack;
  },
  /** The optional toast runtime listens for this page's lifetime, once its chunk arrives. */
  listeners,
};
