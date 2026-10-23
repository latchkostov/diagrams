import { useSyncExternalStore } from "react";
import { useInteraction } from "./useInteraction";

/** A primitive snapshot: only the node whose lit dot changes rerenders. Handle owns its React class. */
export function useConnectPort(node: string) {
  const controller = useInteraction();
  const read = () => {
    const p = controller?.gesture?.preview;
    return (p?.kind === "connect" || p?.kind === "edge.end") && p.over?.node === node ? p.over.side : undefined;
  };
  return useSyncExternalStore(controller?.subscribe ?? noSubscribe, read, read);
}

const noSubscribe = () => () => {};
