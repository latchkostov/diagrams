/** Stable arrival scheduling. Idle ticks inspect only the earliest trip. Arrays survive structuredClone. */
export interface Due {
  end: number;
  id: number;
}
const before = (a: Due, b: Due) => a.end < b.end || (a.end === b.end && a.id < b.id);
export function pushDue<T extends Due>(heap: T[], item: T, indices?: Map<number, number>): void {
  let index = heap.length;
  heap.push(item);
  while (index > 0) {
    const parent = (index - 1) >>> 1;
    if (!before(item, heap[parent])) break;
    heap[index] = heap[parent];
    indices?.set(heap[index].id, index);
    index = parent;
  }
  heap[index] = item;
  indices?.set(item.id, index);
}
export function removeDue<T extends Due>(heap: T[], id: number, indices: Map<number, number>): T | undefined {
  const index = indices.get(id);
  return index === undefined ? undefined : removeAt(heap, index, indices);
}
export function popDue<T extends Due>(heap: T[], indices?: Map<number, number>): T {
  return removeAt(heap, 0, indices);
}
function removeAt<T extends Due>(heap: T[], at: number, indices?: Map<number, number>): T {
  const first = heap[at];
  const last = heap.pop()!;
  indices?.delete(first.id);
  if (at < heap.length) {
    let index = at;
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      if (!before(last, heap[parent])) break;
      heap[index] = heap[parent];
      indices?.set(heap[index].id, index);
      index = parent;
    }
    while (index * 2 + 1 < heap.length) {
      let child = index * 2 + 1;
      if (child + 1 < heap.length && before(heap[child + 1], heap[child])) child++;
      if (!before(heap[child], last)) break;
      heap[index] = heap[child];
      indices?.set(heap[index].id, index);
      index = child;
    }
    heap[index] = last;
    indices?.set(last.id, index);
  }
  return first;
}
