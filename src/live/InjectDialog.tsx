import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { dialogTabTarget, useInteraction, type MenuCloseReason } from "../canvas/interaction";
import { useLive } from "./context";
import { knownMessageTypes, suggestedMessageType } from "./storm";
import { LiveIcon } from "./icons";

export interface InjectRequest {
  nodeId: string;
  /** Screen position the menu was opened at. */
  x: number;
  y: number;
}

/** "Inject ▸ Custom…": count, message type and spread for one node. */
export function InjectDialog({ request, onClose }: { request: InjectRequest; onClose: () => void }) {
  const ui = useLive();
  const d = ui.diagram();
  const node = d.nodes.find((n) => n.id === request.nodeId);
  const [count, setCount] = useState(25);
  const [type, setType] = useState(() => suggestedMessageType(d, request.nodeId));
  const [spread, setSpread] = useState(1);
  const first = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLFormElement>(null);
  const interaction = useInteraction();
  /** Why it closed (a pick, Esc, a press outside), for the focus return; `unmount` if it went any other way. */
  const reason = useRef<MenuCloseReason>("unmount");
  const closeWith = (why: MenuCloseReason) => {
    reason.current = why;
    onClose();
  };
  const close = useRef(closeWith);
  const port = useRef(interaction);
  useLayoutEffect(() => {
    close.current = closeWith;
    port.current = interaction;
  });
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    // This node action returns to its originating node (D3). Sampling activeElement here raced the closing
    // context menu: it could be its removed item, the page, or the node its own cleanup had already focused.
    const background = Array.from(document.body.children).filter(
      (child): child is HTMLElement => child instanceof HTMLElement && !child.contains(el),
    );
    const previous = background.map((child) => child.inert);
    for (const child of background) child.inert = true;
    if (first.current) port.current?.dispatch({ type: "dialog.opened", first: first.current });
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        close.current("escape");
      }
      if (e.key !== "Tab") return;
      const target = dialogTabTarget(el, e.shiftKey);
      if (target) {
        e.preventDefault();
        port.current?.dispatch({ type: "dialog.tab", target });
      }
    };
    el.addEventListener("keydown", onKey);
    return () => {
      el.removeEventListener("keydown", onKey);
      background.forEach((child, i) => {
        child.inert = previous[i];
      });
      port.current?.dispatch({
        type: "dialog.closed",
        dialog: "inject",
        opener: null,
        node: request.nodeId,
        reason: reason.current,
      });
    };
  }, [request.nodeId]);

  const submit = () => {
    const n = Math.max(1, Math.min(5000, Math.floor(count) || 1));
    ui.controller.inject(request.nodeId, n, { type: type.trim() || undefined, spreadMs: Math.max(0, spread) * 1000 });
    if (!ui.controller.isPlaying) ui.controller.setPlaying(true);
    closeWith("pick");
  };

  const left = Math.min(Math.max(12, request.x), window.innerWidth - 300);
  const top = Math.min(Math.max(12, request.y), window.innerHeight - 260);
  return createPortal(
    <div
      className="lv-modal-layer"
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget) return;
        // Cancel the pending pointer focus before the controller restores the originating node.
        e.preventDefault();
        closeWith("outside");
      }}
      onContextMenu={(e) => e.preventDefault()}
      data-editor-overlay
      data-testid="live-inject-backdrop"
    >
      <form
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-inject-title"
        tabIndex={-1}
        className="lv-inject"
        style={{ left, top }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        data-testid="live-inject-dialog"
      >
        <div className="lv-inject-title" id="live-inject-title">
          <LiveIcon name="bolt" size={14} /> Inject at <strong>{node?.label ?? request.nodeId}</strong>
        </div>
        <label>
          <span>Messages</span>
          <input
            ref={first}
            type="number"
            min={1}
            max={5000}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            data-testid="live-inject-count"
            name="inject-count"
          />
        </label>
        <label>
          <span>Message type</span>
          <input
            list="lv-known-types"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="mono"
            data-testid="live-inject-type"
            name="inject-type"
          />
          <datalist id="lv-known-types">
            {knownMessageTypes(d).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Spread over (s)</span>
          <input
            type="number"
            min={0}
            max={60}
            step={0.5}
            value={spread}
            onChange={(e) => setSpread(Number(e.target.value))}
            data-testid="live-inject-spread"
            name="inject-spread"
          />
        </label>
        <div className="lv-inject-actions">
          <button type="button" className="btn" onClick={() => closeWith("pick")} data-testid="live-inject-cancel">
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" data-testid="live-inject-submit">
            Inject
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
