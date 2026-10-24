import { useSyncExternalStore } from "react";
import { planningHost } from "../../live/planningHost";

const noSubscribe = () => () => {};
const noCaller = () => undefined;

/** Only policy edits invalidate the inspector; live snapshots change on every tick. */
export function useCallerOverride(edgeId: string) {
  const live = useSyncExternalStore(planningHost.subscribe, planningHost.get, planningHost.get);
  return useSyncExternalStore(
    live?.controller.subscribe ?? noSubscribe,
    () => live?.controller.getState().running?.setup?.edges?.[edgeId]?.caller,
    noCaller,
  );
}
