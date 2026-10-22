import { useCallback, useEffect, useReducer, useState, useSyncExternalStore } from "react";
import type { LiveController } from "./controller";
import type { Trouble } from "./observedTrouble";
import { loadOnce } from "../lib/lazyLoad";

// Detection and its messages load beside the callouts, apart from the live session.
const load = loadOnce(() => import("./troubleTracker"));
const noSubscribe = () => () => {};
const noTrouble = () => undefined;

export function useObservedTrouble(controller: LiveController): {
  trouble?: Trouble;
  dismiss: () => void;
  /** The callout is on screen with this cause: it has had its turn this run. */
  shown: (key: string) => void;
  failed: boolean;
  retry: () => void;
} {
  const [tracker, setTracker] = useState<import("./troubleTracker").TroubleTracker>();
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    let active = true;
    void load().then(
      (m) => {
        if (active) {
          setTracker(new m.TroubleTracker(controller));
          setFailed(false);
        }
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [controller, attempt]);
  const trouble = useSyncExternalStore(tracker?.subscribe ?? noSubscribe, tracker?.current ?? noTrouble);
  const dismiss = useCallback(() => {
    if (!trouble) return;
    tracker?.dismiss(trouble.key);
  }, [tracker, trouble]);
  const shown = useCallback((key: string) => tracker?.shown(key), [tracker]);
  return { trouble, dismiss, shown, failed, retry };
}
