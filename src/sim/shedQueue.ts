import { Deque } from "./deque";
import type { QueuePriority } from "./types";

/** Priority service with FIFO/LIFO within a class. Eviction always chooses the lowest class. */
export class ShedQueue<T extends { priority?: QueuePriority; queueProtected?: boolean }> {
  /** Invalidates the independent test oracle only when membership or an item’s size changes. */
  revision = 0;
  touch(): void {
    this.revision++;
  }
  private protected = new Deque<T>();
  private queues = [new Deque<T>(), new Deque<T>(), new Deque<T>()];
  get length(): number {
    return this.protected.length + this.queues.reduce((n, q) => n + q.length, 0);
  }
  private service(): Deque<T> | undefined {
    return this.protected.length ? this.protected : this.queues.find((q) => q.length);
  }
  private lowest(): number {
    for (let i = 2; i >= 0; i--) if (this.queues[i].length) return i;
    return -1;
  }
  peek(): T | undefined {
    return this.service()?.peek();
  }
  peekBack(): T | undefined {
    return this.protected.length ? this.protected.peek() : this.service()?.peekBack();
  }
  shift(): T | undefined {
    this.touch();
    return this.service()?.shift();
  }
  pop(): T | undefined {
    this.touch();
    return this.protected.length ? this.protected.shift() : this.service()?.pop();
  }
  push(item: T): void {
    this.touch();
    if (item.queueProtected) this.protected.push(item);
    else this.queues[this.rank(item)].push(item);
  }
  private rank(item: T): number {
    return { critical: 0, normal: 1, sheddable: 2 }[item.priority ?? "normal"] ?? 1;
  }
  evict(arrival: T, oldest: boolean, take = true): T | undefined {
    const rank = this.lowest();
    if (rank < 0 || rank < this.rank(arrival) || (!oldest && rank === this.rank(arrival))) return undefined;
    return this.evictLowest(oldest, take);
  }
  /** Configuration shrink has no arriving request; every waiting class is eligible. */
  evictLowest(oldest: boolean, take = true): T | undefined {
    const rank = this.lowest();
    if (rank < 0) return undefined;
    if (!take) return oldest ? this.queues[rank].peek() : this.queues[rank].peekBack();
    this.touch();
    return oldest ? this.queues[rank].shift() : this.queues[rank].pop();
  }
  find(test: (item: T) => boolean): T | undefined {
    for (const q of [this.protected, ...this.queues]) {
      const item = q.find(test);
      if (item !== undefined) return item;
    }
    return undefined;
  }
  *[Symbol.iterator](): IterableIterator<T> {
    yield* this.protected;
    for (const q of this.queues) yield* q;
  }
  clear(): void {
    this.touch();
    this.protected.clear();
    for (const q of this.queues) q.clear();
  }
  /** Restore class prototypes after the engine clones its graph. */
  restore(): void {
    Object.setPrototypeOf(this.protected, Deque.prototype);
    for (const q of this.queues) Object.setPrototypeOf(q, Deque.prototype);
  }
}
