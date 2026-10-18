import { useEffect, useState, useSyncExternalStore } from "react";
import { ViewportPortal, useStore, type ReactFlowState } from "@xyflow/react";
import type { RoomPeer, RoomPresence } from "../editor/room";
import "./presence.css";

// Who else is in a room, drawn in the canvas's own layer (flow space, so it pans and zooms with the diagram): each
// peer's selection as a 2 px outline in their colour with their name on the first item, and their pointer with their
// name. Purely a picture: it never selects, focuses or moves anything (pointer-events off, aria-hidden), and a
// presence change reaches the camera only as remote.changed{presence}, which decides nothing (camera row C1).

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxes(s: ReactFlowState, peers: readonly RoomPeer[]): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const p of peers)
    for (const id of p.selection) {
      if (out.has(id)) continue;
      const n = s.nodeLookup.get(id);
      if (!n || n.hidden) continue;
      const w = n.measured?.width ?? n.width ?? 0;
      const h = n.measured?.height ?? n.height ?? 0;
      if (w && h) out.set(id, { id, x: n.internals.positionAbsolute.x, y: n.internals.positionAbsolute.y, w, h });
    }
  return out;
}

const sameBoxes = (a: Map<string, Box>, b: Map<string, Box>) =>
  a.size === b.size &&
  [...a].every(([id, x]) => {
    const y = b.get(id);
    return !!y && y.x === x.x && y.y === x.y && y.w === x.w && y.h === x.h;
  });

export function PresenceLayer({ presence, onChange }: { presence: RoomPresence; onChange: () => void }) {
  const revision = useSyncExternalStore(presence.subscribe, presence.revision);
  // The camera hears of it, and decides nothing (C1).
  useEffect(() => onChange(), [revision, onChange]);
  const peers = presence.peers();
  // A still cursor hides after a while: look again when the next one does.
  const [, tick] = useState(0);
  const nextHide = Math.min(...peers.map((p) => (p.cursorHideIn > 0 ? p.cursorHideIn : Infinity)));
  useEffect(() => {
    if (!Number.isFinite(nextHide)) return;
    const id = setTimeout(() => tick((n) => n + 1), nextHide + 1);
    return () => clearTimeout(id);
  }, [nextHide, revision]);
  const placed = useStore((s: ReactFlowState) => boxes(s, peers), sameBoxes);
  const zoom = useStore((s: ReactFlowState) => s.transform[2]);
  if (!peers.length) return null;
  return (
    <ViewportPortal>
      <div className="presence-layer" data-testid="presence-layer" aria-hidden>
        {[...placed.values()].map((b) => {
          // Everyone who selected it: a ring each (one outside the other) and their names side by side.
          const who = peers.filter((p) => p.selection.includes(b.id));
          const named = who.filter((p) => p.selection.find((x) => placed.has(x)) === b.id);
          return (
            <div
              key={b.id}
              className="presence-item"
              data-testid={`presence-outline-${b.id}`}
              data-peer={who.map((p) => p.alias).join(", ")}
              style={{ transform: `translate(${b.x}px, ${b.y}px)`, width: b.w, height: b.h }}
            >
              {who.map((p, i) => (
                <div
                  key={p.sender}
                  className="presence-outline"
                  style={{ inset: -(4 + 3 * i), ["--peer" as string]: p.colour }}
                />
              ))}
              {named.length > 0 && (
                <div className="presence-tags" style={{ transform: `scale(${1 / zoom})` }}>
                  {named.map((p) => (
                    <span key={p.sender} className="presence-tag" style={{ ["--peer" as string]: p.colour }}>
                      {p.alias}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {peers.map(
          (p) =>
            p.cursor &&
            p.cursorHideIn > 0 && (
              <div
                key={`cursor:${p.sender}`}
                className="presence-cursor"
                data-testid="presence-cursor"
                data-peer={p.alias}
                style={{
                  transform: `translate(${p.cursor.x}px, ${p.cursor.y}px) scale(${1 / zoom})`,
                  ["--peer" as string]: p.colour,
                }}
              >
                <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden>
                  <path d="M1 1l13 7.5-6 1.5-3 6z" fill="var(--peer)" stroke="var(--surface)" strokeWidth="1.2" />
                </svg>
                <span className="presence-tag">{p.alias}</span>
              </div>
            ),
        )}
      </div>
    </ViewportPortal>
  );
}
