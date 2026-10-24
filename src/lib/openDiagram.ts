import type { DiagramFile } from "../model/types";
import {
  clearShared,
  createLibraryDiagram,
  DEVICE_PROVIDER,
  DRAFT_SLUG,
  newDraft,
  setShared,
  SHARED_SLUG,
  type SaveTarget,
} from "./diagramIO";
import { newDiagramsPrivate } from "./privacyPrefs";

/** Both app shells persist imports before navigating, with the same privacy and save destination policy. */
export function diagramOpenActions(current: string, navigate: (slug: string) => void) {
  return {
    openDiagram(d: DiagramFile, target?: SaveTarget, sourceSlug?: string) {
      const fromCloud = !!target && target.providerId !== DEVICE_PROVIDER;
      const created = createLibraryDiagram(d, target, undefined, {
        sourceSlug,
        private: !fromCloud && newDiagramsPrivate.get(),
      });
      if (current === SHARED_SLUG) clearShared();
      navigate(created);
      return created;
    },
    openShared(d: DiagramFile) {
      setShared(d);
      navigate(SHARED_SLUG);
    },
    newDiagram() {
      newDraft();
      navigate(DRAFT_SLUG);
    },
  };
}
