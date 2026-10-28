import {
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type CSSProperties,
} from "react";
import { createMachine, defineMachine } from "./machine";
import { lazySurfaces, registerLazySurface, retryLazySurfaces, type LazySurfaceId } from "./lazySurfaces";
import { type LazyComponent, type Placeholder } from "./lazyLoad";
import { notify, toast } from "../interop/ui/toast";
import { t } from "../i18n";
import { useInteraction } from "../canvas/interaction/context";

export type SurfaceState = { value: "idle" | "loading" | "loaded" | "failed" | "retrying" };
type Event = { type: "load" | "resolve" | "reject" | "retry" };
export const lazySurfaceMachine = defineMachine<SurfaceState, Event>({
  initial: { value: "idle" },
  states: ["idle", "loading", "loaded", "failed", "retrying"],
  events: [{ type: "load" }, { type: "resolve" }, { type: "reject" }, { type: "retry" }],
  on: {
    idle: { load: { target: "loading" } },
    loading: { resolve: { target: "loaded" }, reject: { target: "failed" } },
    failed: { retry: { target: "retrying" } },
    retrying: { resolve: { target: "loaded" }, reject: { target: "failed" } },
  },
});

interface Options<P> {
  id: LazySurfaceId;
  load(): Promise<ComponentType<P>>;
  placeholder: { size?: CSSProperties; testId?: string; render?: Placeholder<P> };
  focus: { field?: string; restoreTo?: string; panel?: string };
  export: "await" | "skip";
  retryToast: true;
}
export type LazySurface<P> = LazyComponent<P> & {
  ensureLoaded(): Promise<ComponentType<P>>;
  getSnapshot(): SurfaceState;
  subscribe(listener: () => void): () => void;
};

/** One shared request and recovery path, outside the downloaded component. Preload failures stay silent. */
export function defineLazySurface<P extends object>(options: Options<P>): LazySurface<P> {
  const registration = lazySurfaces.find(([id]) => id === options.id);
  if (!registration || registration[3] !== options.export) throw new Error(`Unregistered lazy surface: ${options.id}`);
  const machine = createMachine(lazySurfaceMachine);
  const listeners = new Set<() => void>();
  const clients = new Set<() => void>();
  let component: ComponentType<P> | undefined;
  let request: Promise<ComponentType<P>> | undefined;
  let toastId: number | undefined;
  const emit = () => listeners.forEach((fn) => fn());
  const getSnapshot = () => machine.state;
  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  };
  const retry = () => {
    clients.values().next().value?.();
    retryLazySurfaces();
  };
  const report = () => {
    if (clients.size && toastId === undefined)
      toastId = notify(t("ai.loadFailed"), {
        kind: "error",
        action: { label: t("common.retry"), run: retry, testId: "lazy-load-retry" },
      });
  };
  function ensureLoaded(): Promise<ComponentType<P>> {
    if (component) return Promise.resolve(component);
    if (request) return request;
    if (toastId !== undefined) toast.dismiss(toastId);
    toastId = undefined;
    machine.send({ type: machine.state.value === "failed" ? "retry" : "load" });
    request = Promise.resolve()
      .then(options.load)
      .then(
        (loaded) => {
          component = loaded;
          machine.send({ type: "resolve" });
          emit();
          return loaded;
        },
        (error: unknown) => {
          request = undefined;
          machine.send({ type: "reject" });
          report();
          emit();
          throw error;
        },
      );
    emit();
    return request;
  }
  function Surface(props: P) {
    const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    // A prior consumer/preload's failure is not this mount's failure: its fresh attempt is pending.
    const [first] = useState(getSnapshot);
    const interaction = useInteraction();
    useLayoutEffect(() => {
      const restore = () => {
        if (options.focus.field)
          interaction?.dispatch({
            type: "panel.field",
            panel: options.focus.panel ?? "inspector",
            field: options.focus.field,
          });
        else if (options.focus.restoreTo)
          interaction?.dispatch({
            type: "panel.field",
            panel: options.focus.panel ?? "inspector",
            field: options.focus.restoreTo,
          });
      };
      clients.add(restore);
      return () => {
        clients.delete(restore);
      };
    }, [interaction]);
    // Reopening is a fresh attempt, including after a failed preload or an expired failure toast.
    useEffect(() => {
      void ensureLoaded().catch(() => {});
    }, []);
    useEffect(() => {
      if (state !== first && state.value === "failed" && machine.state.value === "failed") report();
    }, [state, first]);
    useLayoutEffect(() => {
      interaction?.rendered();
    });
    if (component) {
      const Component = component;
      return <Component {...props} />;
    }
    const status = { failed: state !== first && state.value === "failed", retry };
    if (options.placeholder.render) return options.placeholder.render(props, status);
    return (
      <span
        data-testid={options.placeholder.testId ?? `${options.id}-loading`}
        style={options.placeholder.size}
        aria-busy={!status.failed}
      />
    );
  }
  Surface.preload = () => void ensureLoaded().catch(() => {});
  Surface.ensureLoaded = ensureLoaded;
  Surface.getSnapshot = getSnapshot;
  Surface.subscribe = subscribe;
  registerLazySurface({
    id: options.id,
    active: () => clients.size > 0,
    ensureLoaded,
    getState: () => machine.state.value,
  });
  return Surface;
}
