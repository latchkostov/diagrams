import type { InteractionController } from "./controller";

/** Store readers share the controller's preview without subscribing every edge to gesture starts/ends. */
export const routeGestures = new WeakMap<object, Pick<InteractionController, "gesture">>();
