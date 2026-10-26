/** Selection is shared by the dock and its canvas tags; hover is a separate, transient signal. */
export class FindingSelection {
  private value: { finding: string | null; element: string | null } = { finding: null, element: null };
  private listeners = new Set<() => void>();
  readonly get = () => this.value;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  readonly select = (finding: string) => this.set({ ...this.value, finding });
  readonly filter = (element: string | null) => this.set({ finding: null, element });
  readonly reset = () => this.filter(null);
  private set(value: typeof this.value) {
    if (value.finding === this.value.finding && value.element === this.value.element) return;
    this.value = value;
    this.listeners.forEach((listener) => listener());
  }
}
