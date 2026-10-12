import { useCallback, useEffect, useState } from "react";
import { languageModel, modelAvailability, type ModelAvailability } from "./promptApi";

/**
 * Whether Chrome's built-in model can run here: null while checking (or with no Prompt API at all, which
 * never changes), then its availability. `set` records what a download changed.
 */
export function useModelAvailability(): [ModelAvailability | null, (a: ModelAvailability) => void] {
  const [state, setState] = useState<ModelAvailability | null>(null);
  useEffect(() => {
    if (!languageModel()) return;
    let live = true;
    void modelAvailability().then((a) => live && setState(a));
    return () => {
      live = false;
    };
  }, []);
  return [state, useCallback((a: ModelAvailability) => setState(a), [])];
}
