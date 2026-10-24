import { useStore } from "@xyflow/react";
import { useEffect, useMemo } from "react";
import { t } from "../../i18n";
import { writeLiveParams } from "../urlParams";
import { useFollowing } from "../watchBridge";
import { LiveSync } from "./liveSync";
import type { SessionProps } from "../LiveSession";
import type { LiveSessionState } from "./useLiveSessionState";

export function useLiveDiagramChanges({
  session,
  editor,
  privateDiagram,
}: Pick<SessionProps, "editor" | "privateDiagram"> & { session: LiveSessionState }) {
  const { controller, getDiagram, flash, draftRef, simulations, state, draft } = session;
  // ---------------------------------------------------------------- diagram edits while live

  const nodes = useStore((s) => s.nodes);
  const edges = useStore((s) => s.edges);
  // The document's changes into the run, through one boundary that waits while this person follows someone's
  // shared run (the host's ops bring them, on their ticks) and reconciles once following ends.
  const following = useFollowing();
  const sync = useMemo(() => new LiveSync(controller, () => flash(t("liveSession.restarted"))), [controller, flash]);
  useEffect(() => sync.setFollowing(following), [sync, following]);
  useEffect(() => {
    if (!editor) return;
    const timer = window.setTimeout(() => sync.diagram(getDiagram), 200);
    return () => window.clearTimeout(timer);
  }, [nodes, edges, editor, sync, getDiagram]);

  // A saved simulation edited elsewhere (undo, the panel's Save) replays with the new definition; removed, free play.
  useEffect(() => {
    sync.simulations(simulations, () => draftRef.current?.id);
    // Session-owned refs and setters are stable; preserve the original dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulations, sync]);

  // Mirror the live state into the URL (canvas only) so the address is a shareable live link. A private diagram
  // can't be shared as one, and its simulation ids can carry its words: only `live=1` goes in its address.
  const simId = state.simulation && state.simulation.id !== draft?.id ? state.simulation.id : null;
  useEffect(() => {
    if (editor) writeLiveParams(true, privateDiagram ? null : simId);
  }, [editor, simId, privateDiagram]);
}
