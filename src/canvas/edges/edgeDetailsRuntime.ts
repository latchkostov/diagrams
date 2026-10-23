import { loadOnce } from "../../lib/lazyLoad";
const listeners = new Set<() => void>();
export const edgeDetailsSnapshot = () => edgeDetails;
export const subscribeEdgeDetails = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

export let edgeDetails: typeof import("./SettingsCard") | undefined;
export const loadEdgeDetails = loadOnce(async () => {
  edgeDetails = await import("./SettingsCard");
  for (const listener of listeners) listener();
  return edgeDetails;
});
