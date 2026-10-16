/**
 * What a routing action wants the inspector to open on, once it shows that node: the new route's form (Add traffic
 * mix…), the Default row (Add routes…), or a mix row's value (the first route chosen into a mix, whose section then
 * moves). Cleared once shown; never persisted. Each request has a serial, so asking again while the node is already
 * shown opens the form again.
 */
export type RoutingIntent = "new-route" | "default" | { focusRow: string };
const intents = new Map<string, RoutingIntent>();
const serials = new Map<string, number>();
const listeners = new Set<() => void>();
export const routingIntent = {
  set(nodeId: string, intent: RoutingIntent) {
    intents.set(nodeId, intent);
    serials.set(nodeId, (serials.get(nodeId) ?? 0) + 1);
    listeners.forEach((l) => l());
  },
  peek: (nodeId: string): RoutingIntent | undefined => intents.get(nodeId),
  clear(nodeId: string) {
    intents.delete(nodeId);
  },
  /** Changes with every request for this node: the inspector's routing fields remount on a new one. */
  serial: (nodeId: string): number => serials.get(nodeId) ?? 0,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};
