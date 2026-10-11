import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  useEffect(() => first.current?.select(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = () => {
    const n = Math.max(1, Math.min(5000, Math.floor(count) || 1));
    ui.controller.inject(request.nodeId, n, { type: type.trim() || undefined, spreadMs: Math.max(0, spread) * 1000 });
    if (!ui.controller.isPlaying) ui.controller.setPlaying(true);
    onClose();
  };

  const left = Math.min(Math.max(12, request.x), window.innerWidth - 300);
  const top = Math.min(Math.max(12, request.y), window.innerHeight - 260);
  return createPortal(
    <div className="lv-modal-layer" onPointerDown={(e) => e.target === e.currentTarget && onClose()} data-editor-overlay>
      <form
        className="lv-inject"
        style={{ left, top }}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        data-testid="live-inject-dialog"
      >
        <div className="lv-inject-title">
          <LiveIcon name="bolt" size={14} /> Inject at <strong>{node?.label ?? request.nodeId}</strong>
        </div>
        <label>
          <span>Messages</span>
          <input ref={first} type="number" min={1} max={5000} value={count} onChange={(e) => setCount(Number(e.target.value))} data-testid="live-inject-count" name="inject-count" />
        </label>
        <label>
          <span>Message type</span>
          <input list="lv-known-types" value={type} onChange={(e) => setType(e.target.value)} className="mono" data-testid="live-inject-type" name="inject-type" />
          <datalist id="lv-known-types">
            {knownMessageTypes(d).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label>
          <span>Spread over (s)</span>
          <input type="number" min={0} max={60} step={0.5} value={spread} onChange={(e) => setSpread(Number(e.target.value))} data-testid="live-inject-spread" name="inject-spread" />
        </label>
        <div className="lv-inject-actions">
          <button type="button" className="btn" onClick={onClose} data-testid="live-inject-cancel">
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
