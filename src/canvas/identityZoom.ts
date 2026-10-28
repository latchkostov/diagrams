import { createMachine, defineMachine } from "../lib/machine";

export const identityZoom = defineMachine<
  { value: "settled" | "moving"; scale: number },
  { type: "start"; zoom: number; previous: number } | { type: "end" }
>({
  initial: { value: "settled", scale: 1 },
  states: ["settled", "moving"],
  on: {
    "*": {
      start: {
        target: "moving",
        reduce: (state, event) => {
          const scale = state.value === "moving" ? state.scale : event.previous;
          // Zooming in naturally enlarges fitted ink. Only zooming out can threaten
          // readability, so it advances the layout scale in conservative steps.
          return { ...state, scale: event.zoom < scale ? 2 ** (Math.floor(Math.log2(event.zoom) * 4) / 4) : scale };
        },
      },
      end: { target: "settled" },
    },
  },
  events: [{ type: "start", zoom: 0.5, previous: 1 }, { type: "start", zoom: 1, previous: 0.5 }, { type: "end" }],
});

/** Installed with the lazy identity layer; the first view retains its exact-scale fallback. */
export function mountIdentityZoom(
  root: HTMLElement,
  store: {
    getState(): { transform: number[] };
    subscribe(listener: (state: { transform: number[] }, previous: { transform: number[] }) => void): () => void;
  },
  camera: {
    readonly phase: string;
    readonly state?: { owner: string; view: string };
    subscribe?(listener: () => void): () => void;
  } | null,
) {
  const gesture = createMachine(identityZoom);
  let frame = 0;
  const update = () => {
    const style = root?.style;
    if (!style) return;
    const zoom = Math.max(0.02, store.getState().transform[2]);
    // Round down during input: identity and gesture targets retain their
    // readable/hittable floors without laying out every card on every frame.
    const scale = gesture.state.value === "moving" ? gesture.state.scale : zoom;
    for (const [key, value] of [
      ["--rf-zoom", Math.max(0.02, Math.floor(scale * 50 + 1e-6) / 50)],
      ["--rf-zoom-exact", scale],
    ] as const)
      if (style.getPropertyValue(key) !== String(value)) style.setProperty(key, String(value));
  };
  root.dataset.identityZoom = "1";
  update();
  const end = () => {
    cancelAnimationFrame(frame);
    gesture.send({ type: "end" });
    root.removeAttribute("data-viewport-moving");
    update();
  };
  let animating = camera?.phase === "animating";
  const uncam = camera?.subscribe?.(() => {
    // Camera-owned animations already have a completion signal. Detail must be
    // ready with that signal, including when the page clock stops at idle.
    if (animating && camera.phase === "idle") end();
    animating = camera.phase === "animating";
  });
  const unsubscribe = store.subscribe((s, old) => {
    if (s.transform[2] === old.transform[2]) return;
    cancelAnimationFrame(frame);
    const moving =
      !camera ||
      camera.phase === "idle" ||
      (camera.phase === "animating" && camera.state?.owner === "manual" && camera.state.view === "custom");
    gesture.send(moving ? { type: "start", zoom: s.transform[2], previous: old.transform[2] } : { type: "end" });
    root?.toggleAttribute("data-viewport-moving", moving);
    update();
    if (moving) {
      // Four quiet frames join wheel bursts even when a busy frame outlasts
      // React Flow's wheel-end timer. Camera-owned fits keep their readiness.
      const settle = (remaining: number) => {
        frame = requestAnimationFrame(() => {
          if (remaining > 1) settle(remaining - 1);
          else {
            end();
          }
        });
      };
      settle(4);
    }
  });
  return () => {
    unsubscribe();
    uncam?.();
    cancelAnimationFrame(frame);
    root.removeAttribute("data-viewport-moving");
    root.removeAttribute("data-identity-zoom");
  };
}
