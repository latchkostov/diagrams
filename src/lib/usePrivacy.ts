import { useEffect, useState } from "react";
import { DIAGRAMS_CHANGED, getPrivacyFlags, type PrivacyFlags } from "./diagramIO";

/** Asks the canvas to confirm turning Private off (the badge beside the title; the App shows the dialog). */
export const PRIVACY_REQUEST = "diagrams:privacy-request";

const same = (a: PrivacyFlags, b: PrivacyFlags) =>
  !!a.localOnly === !!b.localOnly && !!a.private === !!b.private && !!a.onDevice === !!b.onDevice;

/** A diagram's privacy provenance, re-read whenever the library or a slot changes (here or in another tab). */
export function usePrivacyFlags(slug: string): PrivacyFlags {
  const [flags, setFlags] = useState(() => getPrivacyFlags(slug));
  const [shownFor, setShownFor] = useState(slug);
  if (shownFor !== slug) {
    setShownFor(slug);
    setFlags(getPrivacyFlags(slug));
  }
  useEffect(() => {
    const update = () => {
      const next = getPrivacyFlags(slug);
      setFlags((prev) => (same(prev, next) ? prev : next));
    };
    update();
    // Another tab's entry changes arrive as DIAGRAMS_CHANGED too (diagramIO bridges the storage event).
    window.addEventListener(DIAGRAMS_CHANGED, update);
    return () => window.removeEventListener(DIAGRAMS_CHANGED, update);
  }, [slug]);
  return flags;
}
