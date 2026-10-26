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
  private times = new Float64Array(HISTORY_CAPACITY);
  private aggregate = new Float32Array(HISTORY_CAPACITY);
  private nodes = new Map<string, { values: Float32Array; from: number }>();
  private sequence = 0;
  private bucket = -1;
  private generation = -1;
  private lastTime = -1;
  epoch = 0;

  probe(id: string): void {
    if (!this.nodes.has(id))
      this.nodes.set(id, { values: new Float32Array(HISTORY_CAPACITY * 2), from: this.sequence });
  }
  reset(): void {
    this.nodes.clear();
    this.sequence = 0;
    this.bucket = -1;
    this.lastTime = -1;
    this.epoch++;
  }
  sample(snapshot: Snapshot, generation: number): void {
    if (generation !== this.generation || snapshot.time < this.lastTime) this.reset();
    this.generation = generation;
    this.lastTime = snapshot.time;
    const bucket = Math.floor(snapshot.time / HISTORY_INTERVAL);
    if (bucket === this.bucket) return;
    this.bucket = bucket;
    const slot = this.sequence++ % HISTORY_CAPACITY;
    this.times[slot] = snapshot.time;
    this.aggregate[slot] = snapshot.inSystem;
    for (const [id, node] of this.nodes) {
      node.values[slot * 2] = snapshot.nodes[id]?.throughput ?? 0;
      node.values[slot * 2 + 1] = snapshot.nodes[id]?.backlog ?? 0;
    }
  }
  samples(id: string): RunSample[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    const result: RunSample[] = [];
    for (let i = Math.max(node.from, this.sequence - HISTORY_CAPACITY); i < this.sequence; i++) {
      const slot = i % HISTORY_CAPACITY;
      result.push({ t: this.times[slot], rate: node.values[slot * 2], queue: node.values[slot * 2 + 1] });
    }
    return result;
  }
  inFlight(): { t: number; value: number }[] {
    return Array.from({ length: Math.min(this.sequence, HISTORY_CAPACITY) }, (_, i) => {
      const slot = (Math.max(0, this.sequence - HISTORY_CAPACITY) + i) % HISTORY_CAPACITY;
      return { t: this.times[slot], value: this.aggregate[slot] };
    });
  }
  get trackedNodes() {
    return this.nodes.size;
  }
}
