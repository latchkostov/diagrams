import { createContext, useContext } from "react";
import type { InteractionController } from "./controller";

/** Shared by optional surfaces without importing the canvas controller's React adapter. */
export const InteractionContext = createContext<InteractionController | null>(null);

export function useInteraction() {
  return useContext(InteractionContext);
}
