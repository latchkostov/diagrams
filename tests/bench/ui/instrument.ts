// Page-side instrumentation for the browser benchmarks (docs/BENCHMARKS.md § Method), installed with addInitScript
// before the app's own scripts. Plain JavaScript strings: they run in the page, not in Node.
//
// - Event Timing (`event`, durationThreshold 16) and long animation frames, buffered from the start.
// - Input to next paint: for every trusted keydown, pointerdown, wheel and dragging pointermove, the time from the
//   event's timestamp to the end of the next frame (a requestAnimationFrame callback, then a message posted from it, which runs after that frame's
//   paint). Unlike Event Timing it has no 16 ms floor, so a 4 ms keystroke still counts as 4.
// - The first frame with a diagram node on screen (`window.__bench.firstNode`), and frame times on request.
// - Render counting (RENDER_HOOK, only when asked): a stand-in React DevTools hook that walks each committed fiber
//   tree and counts the function components that rendered in that commit, by component type. It works on production
//   React: a fiber rendered in a commit if it's new, or if it has the PerformedWork flag (1) and its parent's
//   children were reconciled in the commit (a subtree React bailed out of keeps its old fibers, flags and all, and
//   shares them with the alternate tree: those are skipped). Names come from the names build (keepNames).

export const OBSERVERS = `(() => {
  const bench = (window.__bench = { events: [], loaf: [], longtasks: [], paints: [], frames: [], firstNode: 0, nodeIds: null, framing: false });
  // Frame times while asked (startFrames / stopFrames): requestAnimationFrame timestamps.
  bench.startFrames = () => {
    bench.frames = [];
    bench.framing = true;
    const loop = (t) => { if (!bench.framing) return; bench.frames.push(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  };
  bench.stopFrames = () => { bench.framing = false; return bench.frames; };
  // The painted frame in which "ready()" first holds (until), or an element by test id first exists and passes "test"
  // (when): polled once a frame, then a message posted from that frame (it runs after the paint). Gives up after
  // "maxMs" (resolves NaN).
  bench.until = (ready, maxMs = 120000) => new Promise((resolve) => {
    const until = performance.now() + maxMs;
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve(performance.now());
    const tick = () => {
      if (ready()) channel.port2.postMessage(0);
      else if (performance.now() > until) resolve(NaN);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  bench.when = (testId, test, maxMs) =>
    bench.until(() => {
      const el = document.querySelector('[data-testid="' + testId + '"]');
      return !!el && (!test || test(el));
    }, maxMs);
  // Observers deliver their entries in a later, low-priority task: flush() takes what's pending at once, so a reading
  // right after a long frame sees it.
  const observers = [];
  bench.flush = () => { for (const [o, push] of observers) for (const e of o.takeRecords()) push(e); };
  const observe = (type, push, extra) => {
    try {
      const o = new PerformanceObserver((list) => { for (const e of list.getEntries()) push(e); });
      o.observe({ type, buffered: true, ...extra });
      observers.push([o, push]);
    } catch {}
  };
  observe("event", (e) => bench.events.push({ name: e.name, start: e.startTime, duration: e.duration, id: e.interactionId || 0 }), { durationThreshold: 16 });
  observe("long-animation-frame", (e) => bench.loaf.push({
    start: e.startTime,
    duration: e.duration,
    blocking: e.blockingDuration || 0,
    script: (e.scripts || []).reduce((s, x) => s + x.duration, 0),
    style: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0,
  }));
  observe("longtask", (e) => bench.longtasks.push({ start: e.startTime, duration: e.duration }));
  // Input to next paint, for each trusted keydown and pointerdown, and pointermove with a button down (a drag).
  const channel = new MessageChannel();
  let pending = [];
  channel.port1.onmessage = () => {
    const now = performance.now();
    for (const p of pending) bench.paints.push({ type: p.type, key: p.key, start: p.start, ms: now - p.start });
    pending = [];
  };
  for (const type of ["keydown", "pointerdown", "pointermove", "wheel"])
    window.addEventListener(type, (e) => {
      if (!e.isTrusted || (type === "pointermove" && !e.buttons)) return;
      pending.push({ type, key: e.key || "", start: e.timeStamp });
      requestAnimationFrame(() => channel.port2.postMessage(0));
    }, true);
  // The first frame with a diagram node in it.
  const watch = new MutationObserver(() => {
    if (bench.firstNode || !document.querySelector('[data-testid^="node-"]')) return;
    const ids = bench.nodeIds;
    const found = [...document.querySelectorAll('[data-testid^="node-"]')].some((el) => !ids || ids.has(el.getAttribute("data-testid").slice(5)));
    if (!found) return;
    watch.disconnect();
    requestAnimationFrame(() => { bench.firstNode = performance.now(); });
  });
  watch.observe(document, { childList: true, subtree: true });
})();`;

export const RENDER_HOOK = `(() => {
  let on = false;
  let commits = 0;
  const counts = new Map();
  let explain = false;
  const causes = new Map();
  const name = (t) => t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || (t.type && (t.type.displayName || t.type.name)) || "anonymous";
  // FunctionComponent 0, ClassComponent 1, ForwardRef 11, SimpleMemoComponent 15: the fibers that run a component.
  // MemoComponent (14) is the wrapper around one of those, counted through its child.
  const COMPONENT = new Set([0, 1, 11, 15]);
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers: new Map(),
    supportsFiber: true,
    inject(r) { const id = this.renderers.size + 1; this.renderers.set(id, r); return id; },
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
    onCommitFiberRoot(_id, root) {
      if (!on) return;
      commits++;
      const stack = [root.current];
      while (stack.length) {
        const f = stack.pop();
        if (COMPONENT.has(f.tag) && (!f.alternate || (f.flags & 1) === 1)) {
          const t = f.type;
          counts.set(t, (counts.get(t) || 0) + 1);
          // Opt-in why-did-you-render style diagnostics. Test-installed only, never app code.
          if (explain) {
            const before = f.alternate;
            const props = before ? Object.keys(f.memoizedProps || {}).filter(k => !Object.is(f.memoizedProps[k], before.memoizedProps?.[k])) : [];
            const hooks = [];
            let a = f.memoizedState, b = before?.memoizedState, index = 0;
            while (a && b) {
              if (!Object.is(a.memoizedState, b.memoizedState)) hooks.push(index);
              a = a.next; b = b.next; index++;
            }
            let aContext = f.dependencies?.firstContext, bContext = before?.dependencies?.firstContext;
            let context = false;
            while (aContext && bContext) {
              context ||= !Object.is(aContext.memoizedValue, bContext.memoizedValue);
              aContext = aContext.next; bContext = bContext.next;
            }
            const cause = JSON.stringify({ component: name(t), props, hooks, context, parent: f.return?.type ? name(f.return.type) : null });
            causes.set(cause, (causes.get(cause) || 0) + 1);
          }
        }
        // Children not reconciled in this commit are shared with the alternate tree: skip them.
        if (f.child && !(f.alternate && f.alternate.child === f.child)) stack.push(f.child);
        if (f.sibling) stack.push(f.sibling);
      }
    },
  };
  window.__benchRenders = {
    start(why = false) { counts.clear(); causes.clear(); explain = why; commits = 0; on = true; },
    stop() {
      on = false;
      const byName = {};
      for (const [t, n] of counts) { const k = name(t); byName[k] = (byName[k] || 0) + n; }
      let total = 0;
      for (const n of counts.values()) total += n;
      return { commits, total, byName, ...(explain ? { causes: [...causes].map(([cause, count]) => ({ ...JSON.parse(cause), count })) } : {}) };
    },
  };
})();`;

declare global {
  interface Window {
    __bench: {
      events: { name: string; start: number; duration: number; id: number }[];
      loaf: { start: number; duration: number; blocking: number; script: number; style: number }[];
      longtasks: { start: number; duration: number }[];
      paints: { type: string; key: string; start: number; ms: number }[];
      frames: number[];
      firstNode: number;
      nodeIds: Set<string> | null;
      startFrames(): void;
      stopFrames(): number[];
      when(testId: string, test?: (el: Element) => boolean, maxMs?: number): Promise<number>;
      until(ready: () => boolean, maxMs?: number): Promise<number>;
      flush(): void;
    };
    __benchRenders?: {
      start(explain?: boolean): void;
      stop(): {
        commits: number;
        total: number;
        byName: Record<string, number>;
        causes?: {
          component: string;
          props: string[];
          hooks: number[];
          context: boolean;
          parent: string | null;
          count: number;
        }[];
      };
    };
  }
}

/**
 * The e2e build's own counters (src/canvas/checks/useChecks.ts, src/planning/cache.ts,
 * src/canvas/checks/simulationRuns.ts): read through a cast, not declared on Window, so they never clash with a spec
 * that declares them its own way.
 */
export interface AppHooks {
  __checks?: { started: number; finished: number; held: boolean; skipped: number };
  __planning?: { reads: number; analyses: number; explanations: number };
  __simulations?: { started: number; finished: number; stopped: number };
  /** Live view (src/live/LiveSession.tsx): Traffic × 10 without the panel, and the decorator's counters. */
  __liveBench?: {
    timesTen(): void;
    decorations: { applies: number; publishes: number; edgeFlips: number; elements: number; large: boolean };
  };
}
