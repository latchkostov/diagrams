/**
 * What a right-click routing action wants the inspector to open on, once it shows that node: the new route's form
 * (Add traffic mix…) or the Default row (Add routes…). Cleared once shown; never persisted.
 */
const intents = new Map<string, "new-route" | "default">();
export const routingIntent = {
  set(nodeId: string, intent: "new-route" | "default") {
    intents.set(nodeId, intent);
  },
  peek: (nodeId: string): "new-route" | "default" | undefined => intents.get(nodeId),
  clear(nodeId: string) {
    intents.delete(nodeId);
  },
};
