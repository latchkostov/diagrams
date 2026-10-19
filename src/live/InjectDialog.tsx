import { useRef, useState } from "react";
import { InjectFrame } from "./InjectFrame";
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

  const submit = () => {
    const n = Math.max(1, Math.min(5000, Math.floor(count) || 1));
    ui.controller.inject(request.nodeId, n, { type: type.trim() || undefined, spreadMs: Math.max(0, spread) * 1000 });
    if (!ui.controller.isPlaying) ui.controller.setPlaying(true);
  };

  return (
    <InjectFrame
      request={request}
      onClose={onClose}
      onSubmit={submit}
      first={first}
      actions={
        <button type="submit" className="btn btn-primary" data-testid="live-inject-submit">
          Inject
        </button>
      }
      title={
        <>
          <LiveIcon name="bolt" size={14} /> Inject at <strong>{node?.label ?? request.nodeId}</strong>
        </>
      }
    >
      <>
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
      </>
    </InjectFrame>
  );
}
