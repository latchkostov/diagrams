import { useSyncExternalStore } from "react";

const query = "(max-width: 639px)";
const read = () => window.matchMedia(query).matches;
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
export const usePhone = () => useSyncExternalStore(subscribe, read);
