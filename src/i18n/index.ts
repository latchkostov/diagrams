import { useSyncExternalStore } from "react";
import { state, getLocale } from "./core";
export * from "./core";

const subscribe = (f: () => void) => {
  state.f.add(f);
  return () => void state.f.delete(f);
};

/** The current language, re-rendering the component when it changes. Call it in any component that shows text. */
export const useLocale = (): string => useSyncExternalStore(subscribe, getLocale, getLocale);
