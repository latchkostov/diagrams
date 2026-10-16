import { useEffect, useState, useSyncExternalStore, useRef } from "react";
import { CanvasView } from "../../canvas/CanvasView";
import { t, useLocale } from "../../i18n";
import { downloadText } from "../../interop/files";
import { serializeNative } from "../../interop/native";
import type { CanvasHandle } from "../../canvas/CanvasView";
import { CollaborativeEditorRoom } from "../editorRoom";
import { deriveRoomKeys, newRoom } from "../keys";
import { consumeRoomFragment, formatRoomLink, parseRoomLink, RoomLinkError, type RoomLink } from "../link";
import { IndexedDbRecoveryStore } from "../recoveryStore";
import { CollabSession } from "../session";
import { broadcastWire, labBridge } from "./bridge";
import { demoDiagram } from "./demo";
import "./editorDemo.css";

export function EditorDemo() {
  useLocale();
  const [room, setRoom] = useState<CollaborativeEditorRoom>();
  const [failed, setFailed] = useState(false);
  const readEntry = () => {
    let invitation: RoomLink | undefined;
    let invalid = false;
    try {
      invitation = parseRoomLink(location.href);
    } catch (e) {
      invalid = !(e instanceof RoomLinkError && e.problem === "missing");
    }
    return {
      key: invitation ?? window.__collabC1?.room ?? newRoom(),
      joining: !!invitation || new URLSearchParams(location.search).has("join"),
      invalid,
    };
  };
  const [entry, setEntry] = useState(readEntry);
  useEffect(() => {
    const changed = () => {
      if (!location.hash.includes("room=")) return;
      const next = readEntry();
      try {
        consumeRoomFragment();
      } catch {
        /* The new entry displays a generic error. */
      }
      setRoom(undefined);
      setEntry(next);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  useEffect(() => {
    let disposed = false;
    let session: CollabSession | undefined;
    let localWire: ReturnType<typeof broadcastWire> | undefined;
    let transport: ReturnType<typeof labBridge> | undefined;
    const fixture = window.__collabC1;
    const goodbye = (event: PageTransitionEvent) => {
      if (event.persisted) transport?.suspend();
      else transport?.close();
    };
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) transport?.resume();
    };
    window.addEventListener("pagehide", goodbye);
    window.addEventListener("pageshow", restore);
    const start = async () => {
      consumeRoomFragment();
      if (entry.invalid) throw new Error("invalid-room-link");
      const keys = await deriveRoomKeys(entry.key);
      if (disposed) return;
      const wire = fixture?.wire ?? (localWire = broadcastWire(keys.roomId));
      session = await CollabSession.open({
        room: entry.key,
        transport: (transport = labBridge(wire)),
        privacy: {},
        // A fixture joiner waits for a peer or a recovered checkpoint, never creates a competing seed.
        initial: entry.joining ? undefined : demoDiagram(),
        recovery: new IndexedDbRecoveryStore(),
      });
      if (disposed) {
        return;
      }
      setRoom(new CollaborativeEditorRoom(session, () => ({})));
    };
    let disposal: Promise<void> | undefined;
    const dispose = () =>
      (disposal ??= (async () => {
        await session?.leave();
        session?.doc.destroy();
        transport?.close();
        localWire?.close();
      })());
    const opening = start().catch(async () => {
      await dispose();
      if (!disposed) setFailed(true);
    });
    return () => {
      disposed = true;
      window.removeEventListener("pagehide", goodbye);
      window.removeEventListener("pageshow", restore);
      void opening.then(dispose);
    };
  }, [entry]);
  if (!room)
    return (
      <p data-testid="collab-editor-loading" role={failed ? "alert" : "status"}>
        {failed ? t("collab.loadFailed") : t("collab.connecting")}
      </p>
    );
  return <RoomEditor room={room} roomKey={entry.key} />;
}

function RoomEditor({ room, roomKey }: { room: CollaborativeEditorRoom; roomKey: RoomLink }) {
  const canvas = useRef<CanvasHandle>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const base = new URL(location.href);
  base.search = "";
  base.hash = "";
  const recoveryUrl = new URL(formatRoomLink(base.href, roomKey));
  recoveryUrl.search = new URLSearchParams({ view: "lab", preset: "collab-c1a" }).toString();
  const session = room.session;
  useSyncExternalStore(
    (fn) => session.onChange(fn),
    () =>
      `${session.roomStatus}:${session.hasDocument}:${session.recovery?.saved}:${session.recovery?.problem ?? ""}:${session.doc.project().status}`,
  );
  const projection = session.doc.project();
  const ready = projection.diagram !== undefined;
  return (
    <section className="collab-editor-demo" data-testid="collab-editor-demo">
      <button
        className="btn"
        data-testid="collab-copy-recovery-link"
        onClick={() => {
          void navigator.clipboard
            .writeText(recoveryUrl.href)
            .then(() => {
              setCopied(true);
              setCopyFailed(false);
            })
            .catch(() => {
              setCopied(false);
              setCopyFailed(true);
            });
        }}
      >
        {copied ? t("collab.linkCopied") : t("collab.copyRecoveryLink")}
      </button>
      {copyFailed && (
        <label data-testid="collab-link-fallback">
          {t("collab.copyFailed")}
          <input
            data-testid="collab-recovery-link"
            readOnly
            value={recoveryUrl.href}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
      )}
      <div
        role="status"
        data-testid="collab-room-status"
        data-status={session.roomStatus}
        data-saved={session.recovery?.saved ? "true" : "false"}
      >
        {
          {
            "saved-device": t("collab.savedDevice"),
            synced: t("collab.synced"),
            connecting: t("collab.connecting"),
            offline: t("collab.offline"),
          }[session.roomStatus]
        }
        {session.recovery?.problem && (
          <span data-testid="collab-recovery-problem">
            {" "}
            {session.recovery.problem === "corrupt" ? t("collab.corrupt") : t("collab.storageUnavailable")}
          </span>
        )}
        {session.recovery?.problem && ready && (
          <button
            className="btn"
            data-testid="collab-save-copy"
            onClick={() => {
              const diagram = canvas.current?.getDiagram();
              if (diagram) downloadText(serializeNative(diagram), "room-copy.diagram.json", "application/json");
            }}
          >
            {t("collab.saveCopy")}
          </button>
        )}
      </div>
      {projection.status === "invalid" && (
        <div role="alert" data-testid="collab-invalid-document">
          <p>{t("collab.invalidDocument")}</p>
          <button
            className="btn"
            data-testid="collab-save-room-data"
            onClick={() =>
              downloadText(
                JSON.stringify(session.doc.recoveryExport(), null, 2),
                "room-recovery.json",
                "application/json",
              )
            }
          >
            {t("collab.saveRoomData")}
          </button>
        </div>
      )}
      <p>{t("collab.labOnly")}</p>
      <div className="collab-real-editor">
        {ready && (
          <CanvasView
            ref={canvas}
            slug={`room-${session.keys.roomId}`}
            initial={projection.diagram}
            room={room}
            presenting={false}
            onExitPresent={() => {}}
          />
        )}
      </div>
    </section>
  );
}
