/** Amortized O(1) FIFO, including when a paused node has a large backlog. */
export class Deque<T> {
  private items: (T | undefined)[] = [];
  private head = 0;

  get length(): number {
    return this.items.length - this.head;
  }
  peek(): T | undefined {
    return this.items[this.head];
  }
  peekBack(): T | undefined {
    return this.items.at(-1);
  }
  pop(): T | undefined {
    return this.length ? this.items.pop() : undefined;
  }
  push(item: T): void {
    this.items.push(item);
  }
  shift(): T | undefined {
    if (!this.length) return undefined;
    const item = this.items[this.head];
    this.items[this.head++] = undefined;
    if (this.head >= 1024 && this.head * 2 >= this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
    return item;
  }
  /** The first queued item matching `test`, front to back. */
  find(test: (item: T) => boolean): T | undefined {
    for (let i = this.head; i < this.items.length; i++) if (test(this.items[i] as T)) return this.items[i];
    return undefined;
  }
  *[Symbol.iterator](): IterableIterator<T> {
    for (let i = this.head; i < this.items.length; i++) yield this.items[i] as T;
  }
  clear(): void {
    this.items = [];
    this.head = 0;
  }
}
