/** Five observations per simulated second, bounded to fifteen minutes. Only probed nodes allocate storage. */
export const HISTORY_CAPACITY = 4500;
export const HISTORY_INTERVAL = 200;
export interface RunSample {
  t: number;
  rate: number;
  queue: number;
}
interface Snapshot {
  time: number;
  inSystem: number;
  nodes: Record<string, { throughput: number; backlog: number }>;
}

export class RunHistory {
  #times = new Float64Array(HISTORY_CAPACITY);
  #aggregate = new Float32Array(HISTORY_CAPACITY);
  #nodes = new Map<string, { values: Float32Array; from: number }>();
  #sequence = 0;
  #bucket = -1;
  #generation = -1;
  #lastTime = -1;
  version = 0;

  probe(id: string): void {
    if (!this.#nodes.has(id))
      this.#nodes.set(id, { values: new Float32Array(HISTORY_CAPACITY * 2), from: this.#sequence });
  }
  reset(): void {
    this.#nodes.clear();
    this.#sequence = 0;
    this.#bucket = -1;
    this.#lastTime = -1;
    this.version++;
  }
  sample(snapshot: Snapshot, generation: number): void {
    if (generation !== this.#generation || snapshot.time < this.#lastTime) this.reset();
    this.#generation = generation;
    this.#lastTime = snapshot.time;
    const bucket = Math.floor(snapshot.time / HISTORY_INTERVAL);
    if (bucket === this.#bucket) return;
    this.#bucket = bucket;
    this.version++;
    const slot = this.#sequence++ % HISTORY_CAPACITY;
    this.#times[slot] = snapshot.time;
    this.#aggregate[slot] = snapshot.inSystem;
    for (const [id, node] of this.#nodes) {
      node.values[slot * 2] = snapshot.nodes[id]?.throughput ?? 0;
      node.values[slot * 2 + 1] = snapshot.nodes[id]?.backlog ?? 0;
    }
  }
  /** Read-only ring view for plotting without materializing every observation. */
  series(id?: string) {
    const node = id === undefined ? { values: this.#aggregate, from: 0 } : this.#nodes.get(id);
    return (
      node && {
        times: this.#times as Readonly<Float64Array>,
        values: node.values as Readonly<Float32Array>,
        from: Math.max(node.from, this.#sequence - HISTORY_CAPACITY),
        to: this.#sequence,
      }
    );
  }
  get trackedNodes() {
    return this.#nodes.size;
  }
}
