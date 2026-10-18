import { createContext, useContext, useState, useSyncExternalStore } from "react";
import { createInteractionController, type InteractionCamera, type InteractionController } from "./controller";
import { domActive } from "./domPort";

/** The canvas's interaction controller, for what renders inside the canvas (the Inspector, its name fields). */
export const InteractionContext = createContext<InteractionController | null>(null);

/** The canvas's interaction controller: the single writer of its menus (and, below, of keyboard focus). */
export function useInteractionCore<P>(camera: InteractionCamera) {
  const [controller] = useState(() => createInteractionController<P>({ active: domActive }, { camera }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return { controller, state };
}

export const useInteraction = () => useContext(InteractionContext);
