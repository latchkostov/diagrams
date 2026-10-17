import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LabCanvas } from "../../lab/LabCanvas";
import type { DiagramFile } from "../../model/types";
import { openRoomClient, type RoomClient } from "../client";
import { realClock } from "../clock";
import { deriveRoomKeys, newRoom } from "../keys";
import { consumeRoomFragment, parseRoomLink, parseRoomValue, ROOM_PARAM, type RoomLink } from "../link";
import { bytesToBase64Url } from "../../interop/codec";
import { createTrackerTransport, SPIKE_STUN, SPIKE_TRACKERS, type TrackerTransport } from "../transport/tracker";
import { applyMoves, demoDiagram, endpointList, refusalMessage } from "./demo";
import { t, useLocale } from "../../i18n";
import { downloadText } from "../../interop/files";
import { serializeNative } from "../../interop/native";

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
  useLocale();
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
  const attempt = useRef(0);
  const [connecting, setConnecting] = useState(false);
  // Unmounting makes any attempt still in flight stale.
  useEffect(
    () => () => {
      attempt.current++;
    },
    [],
  );
  useSyncExternalStore(
    (fn) => conn?.client.session.onChange(fn) ?? (() => {}),
    () => `${conn?.client.session.doc.stats.projections}:${conn?.client.session.connectionFailed}`,
  );
  useEffect(() => {
    if (!conn) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [conn]);

  /**
   * Connecting takes a few awaits; an attempt that the panel no longer wants when they finish (it unmounted, or a
   * newer attempt started) closes what it opened rather than leaving a transport and timers running.
   */
  async function connect() {
    setError("");
    let room: RoomLink;
    try {
      room = readRoom(key);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    const token = ++attempt.current;
    setConnecting(true);
    let transport: TrackerTransport | undefined;
    try {
      const keys = await deriveRoomKeys(room);
      if (token !== attempt.current) return;
      const log = (e: string) => setEvents((list) => [...list.slice(-30), `${new Date().toLocaleTimeString()} ${e}`]);
      transport = createTrackerTransport({
        trackers: endpointList(trackers),
        discovery: keys.discovery,
        signal: keys.signal,
        iceServers: endpointList(stun).map((urls) => ({ urls })),
        onEvent: log,
      });
      const client = await openRoomClient({
        name: create ? "Creator" : "Guest",
        transport,
        room,
        clock: realClock,
        initial: create ? demoDiagram() : undefined,
      });
      if (token !== attempt.current) {
        await client.session.leave();
        return;
      }
      setConn({ client, transport });
    } catch (err) {
      transport?.close();
      if (token === attempt.current) setError((err as Error).message);
    } finally {
      if (token === attempt.current) setConnecting(false);
    }
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
            disabled={!key || connecting}
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
        {conn?.client.session.connectionFailed && (
          <div role="alert" data-testid="collab-spike-connection-failed">
            <p>{t("collab.connectionFailed")}</p>
            <button
              className="btn"
              data-testid="collab-spike-retry"
              onClick={(e) => {
                e.currentTarget
                  .closest("section")
                  ?.querySelector<HTMLElement>('[data-testid="collab-spike-status"]')
                  ?.focus();
                conn.client.session.retryConnection();
              }}
            >
              {t("common.retry")}
            </button>
            <p>{t("collab.fileFallback")}</p>
            {conn.client.diagram && (
              <button
                className="btn"
                data-testid="collab-spike-save-copy"
                onClick={() => {
                  if (conn.client.diagram)
                    downloadText(serializeNative(conn.client.diagram), "room-copy.diagram.json", "application/json");
                }}
              >
                {t("collab.saveCopy")}
              </button>
            )}
          </div>
        )}
      </div>
      {conn && client && (
        <div className="collab-spike-session">
          <p data-testid="collab-spike-status" role="status" tabIndex={-1}>
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
          {client.binding.refused && (
            <p role="alert" data-testid="collab-spike-refused">
              {refusalMessage(client.binding.refused)}
            </p>
          )}
          <ol className="collab-spike-log mono" data-testid="collab-spike-log">
            {events.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ol>
          <div className="collab-canvas">
            {d && <LabCanvas diagram={d} minimap={false} onMove={(moves) => edit((cur) => applyMoves(cur, moves))} />}
          </div>
        </div>
      )}
    </section>
  );
}
