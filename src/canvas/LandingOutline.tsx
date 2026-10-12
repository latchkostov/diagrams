import { useSyncExternalStore } from "react";
import { ViewportPortal } from "@xyflow/react";
import { insertLine, landing } from "./landing";

/**
 * Where a new node lands (an outline), and the edge a held node would be inserted into (its line, lit), in
 * flow coordinates above the nodes. Never in an export: they're editing chrome.
 */
export function LandingOutline() {
  const box = useSyncExternalStore(landing.subscribe, landing.get, landing.get);
  const line = useSyncExternalStore(insertLine.subscribe, insertLine.get, insertLine.get);
  if (!box && !line) return null;
  return (
    <ViewportPortal>
      {box && (
        <div
          className="landing-outline"
          style={{ transform: `translate(${box.x}px, ${box.y}px)`, width: box.width, height: box.height }}
          aria-hidden
          data-testid="landing-outline"
        />
      )}
      {line && (
        <svg className="insert-line" aria-hidden data-testid="insert-line">
          <polyline points={line.map((p) => `${p.x},${p.y}`).join(" ")} className="insert-line-halo" />
          <polyline points={line.map((p) => `${p.x},${p.y}`).join(" ")} />
        </svg>
      )}
    </ViewportPortal>
  );
}
