/** What a test reads of React Flow's store: its zoom and snap radius, and its screen-to-flow mapping. */
export interface FlowProbe {
  zoom: number;
  connectionRadius: number;
  /** A screen point in flow coordinates, as React Flow maps it now (no grid snapping). */
  toFlow(x: number, y: number): { x: number; y: number };
}

declare global {
  interface Window {
    /** Development and E2E builds only: React Flow's store as the canvas sees it now (see flowProbe.ts). */
    __flowProbe?: () => FlowProbe;
  }
}

interface ProbeStore {
  getState(): {
    transform: [number, number, number];
    connectionRadius: number;
    domNode: Element | null;
  };
}

/**
 * The e2e probe onto React Flow's store, through its public store API (useStoreApi), so tests check what React Flow
 * itself will use (the snap radius, the viewport) without reaching into React's internals. Development and e2e
 * (VITE_E2E=1) builds have it; production folds this to undefined, and vite.config.ts's noTestHooks() fails a
 * production build that still names `__flowProbe`. Returns the unpublish.
 */
export const publishFlowProbe: ((store: ProbeStore) => () => void) | undefined =
  import.meta.env.DEV || import.meta.env.VITE_E2E === "1"
    ? (store) => {
        const probe = (): FlowProbe => {
          const { transform, connectionRadius, domNode } = store.getState();
          const [tx, ty, zoom] = transform;
          const origin = domNode?.getBoundingClientRect() ?? { left: 0, top: 0 };
          return {
            zoom,
            connectionRadius,
            toFlow: (x, y) => ({ x: (x - origin.left - tx) / zoom, y: (y - origin.top - ty) / zoom }),
          };
        };
        window.__flowProbe = probe;
        return () => {
          if (window.__flowProbe === probe) delete window.__flowProbe;
        };
      }
    : undefined;
