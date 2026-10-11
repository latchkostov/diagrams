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
  clear(): void {
    this.items = [];
    this.head = 0;
  }
}
