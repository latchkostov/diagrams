import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LabCanvas } from "../../lab/LabCanvas";
import type { DiagramFile } from "../../model/types";
import { openRoomClient, type RoomClient } from "../client";
import { realClock } from "../clock";
import { deriveRoomKeys, newRoom } from "../keys";
import { consumeRoomFragment, parseRoomLink, parseRoomValue, ROOM_PARAM, type RoomLink } from "../link";
import { bytesToBase64Url } from "../../interop/codec";
import { createTrackerTransport, SPIKE_STUN, SPIKE_TRACKERS, type TrackerTransport } from "../transport/tracker";
import { demoDiagram } from "./demo";

// The public-matchmaking spike (C0, Lab only). Nothing connects until "Connect" is pressed: the panel names every
// public service first. Two tabs (or two browsers) with the same room key find each other through public
// BitTorrent trackers and talk over WebRTC; the trackers see what tracker.ts lists, never the key or the diagram.

const roomValue = (r: RoomLink) => `v1.${r.epoch}.${bytesToBase64Url(r.secret)}`;

function readRoom(text: string): RoomLink {
  const t = text.trim();
  return t.includes("#") || t.includes("?")
    ? parseRoomLink(t)
    : parseRoomValue(t.replace(new RegExp(`^${ROOM_PARAM}=`), ""));
}

export function SpikePanel() {
  // A room key in the address bar (`#room=…`) fills the field and leaves the address bar at once. It doesn't connect.
  const [key, setKey] = useState(() => {
    try {
      const r = consumeRoomFragment();
      return r ? roomValue(r) : "";
    } catch {
      return "";
    }
  });
  const [create, setCreate] = useState(false);
  const [trackers, setTrackers] = useState(SPIKE_TRACKERS.join("\n"));
  const [stun, setStun] = useState(SPIKE_STUN.map((s) => s.urls).join("\n"));
  const [error, setError] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [conn, setConn] = useState<{ client: RoomClient; transport: TrackerTransport }>();
  const [, setTick] = useState(0);
  const titleInput = useRef<HTMLInputElement>(null);

  useEffect(() => () => void conn?.client.session.leave(), [conn]);
  useSyncExternalStore(
    (fn) => conn?.client.session.onChange(fn) ?? (() => {}),
    () => conn?.client.session.doc.stats.projections ?? 0,
  );
  useEffect(() => {
    if (!conn) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [conn]);

  async function connect() {
    setError("");
    let room: RoomLink;
    try {
      room = readRoom(key);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    const keys = await deriveRoomKeys(room);
    const log = (e: string) => setEvents((list) => [...list.slice(-30), `${new Date().toLocaleTimeString()} ${e}`]);
    const transport = createTrackerTransport({
      trackers: trackers.split(/\s+/).filter(Boolean),
      discovery: keys.discovery,
      signal: keys.signal,
      iceServers: stun
        .split(/\s+/)
        .filter(Boolean)
        .map((urls) => ({ urls })),
      onEvent: log,
    });
    const client = await openRoomClient({
      name: create ? "Creator" : "Guest",
      transport,
      room,
      clock: realClock,
      initial: create ? demoDiagram() : undefined,
    });
    setConn({ client, transport });
  }

  async function disconnect() {
    await conn?.client.session.leave();
    setConn(undefined);
  }

  const client = conn?.client;
  const d: DiagramFile | undefined = client?.diagram;
  const edit = (change: (x: DiagramFile) => DiagramFile) => {
    client?.edit(change);
    setTick((t) => t + 1);
  };
  const diag = conn?.transport.diagnostics();

  return (
    <section className="collab-spike" data-testid="collab-spike" aria-labelledby="collab-spike-title">
      <h2 id="collab-spike-title">Public matchmaking spike (Lab only)</h2>
      <p className="collab-warn">
        Connecting contacts the public services listed below, run by other people. They see your IP address, the room's
        discovery hash and encrypted offers; the other person sees your IP address too. They never see the room key or
        the diagram. Nothing connects until you press Connect.
      </p>
      <div className="collab-spike-form">
        <label>
          Room key
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="v1.0.…"
            spellCheck={false}
            autoComplete="off"
            data-testid="collab-spike-key"
          />
        </label>
        <button
          className="btn"
          onClick={() => {
            setKey(roomValue(newRoom()));
            setCreate(true);
          }}
          disabled={!!conn}
          data-testid="collab-spike-new"
        >
          New room
        </button>
        <label>
          <input
            type="checkbox"
            checked={create}
            onChange={(e) => setCreate(e.target.checked)}
            disabled={!!conn}
            data-testid="collab-spike-create"
          />{" "}
          I'm creating it (start with the demo diagram)
        </label>
        <label>
          Trackers
          <textarea
            value={trackers}
            onChange={(e) => setTrackers(e.target.value)}
            rows={3}
            disabled={!!conn}
            data-testid="collab-spike-trackers"
          />
        </label>
        <label>
          STUN
          <textarea
            value={stun}
            onChange={(e) => setStun(e.target.value)}
            rows={1}
            disabled={!!conn}
            data-testid="collab-spike-stun"
          />
        </label>
        {conn ? (
          <button className="btn" onClick={() => void disconnect()} data-testid="collab-spike-disconnect">
            Disconnect
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() => void connect()}
            disabled={!key}
            data-testid="collab-spike-connect"
          >
            Connect via public matchmaking
          </button>
        )}
        {error && (
          <p role="alert" data-testid="collab-spike-error">
            {error}
          </p>
        )}
      </div>
      {conn && client && (
        <div className="collab-spike-session">
          <p data-testid="collab-spike-status">
            {client.session.status} · trackers open {diag?.trackersOpen} · peers{" "}
            <span data-testid="collab-spike-peers" data-count={diag?.peers}>
              {diag?.peers}
            </span>{" "}
            · offers waiting {diag?.pendingOffers}
          </p>
          <p data-testid="collab-spike-title" data-title={d?.title ?? ""}>
            {d?.title ?? "Waiting for a peer with the diagram…"}
          </p>
          <div className="collab-actions">
            <input
              ref={titleInput}
              placeholder="New title"
              data-testid="collab-spike-title-input"
              aria-label="New title"
            />
            <button
              className="btn"
              disabled={!client.ready}
              onClick={() => edit((x) => ({ ...x, title: titleInput.current?.value || x.title }))}
              data-testid="collab-spike-set-title"
            >
              Set title
            </button>
          </div>
          <ol className="collab-spike-log mono" data-testid="collab-spike-log">
            {events.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ol>
          <div className="collab-canvas">{d && <LabCanvas key={JSON.stringify(d)} diagram={d} minimap={false} />}</div>
        </div>
      )}
    </section>
  );
}
