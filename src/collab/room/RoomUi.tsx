import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from "react";
import type { CanvasHandle } from "../../canvas/CanvasView";
import { t, useLocale } from "../../i18n";
import { appBaseUrl } from "../../interop/share";
import { copyText } from "../../interop/ui/copyText";
import { Dialog } from "../../interop/ui/Dialog";
import { Glyph } from "../../interop/ui/glyphs";
import { Menu, type MenuEntry } from "../../interop/ui/Menu";
import { PRESENCE_COLOURS } from "../presence";
import type { DiagramFile } from "../../model/types";
import { notify, toast } from "../../interop/ui/toast";
import { downloadText } from "../../interop/files";
import { serializeNative } from "../../interop/native";
import { createLibraryDiagram, getCurrent, getPrivacyFlags, isLibrarySlug, resolveSlug } from "../../lib/diagramIO";
import { canCollaborate } from "../../lib/localOnly";
import { COLLAB_LIMITS } from "../limits";
import { formatRoomLink, type RoomLinkProblem } from "../link";
import type { CollabSession } from "../session";
import type { OpenRoom, RoomLifecycle, RoomNotice } from "./lifecycle";
import { createInteractionController } from "../../canvas/interaction/controller";
import { createDomPort, domScheduler } from "../../canvas/interaction/domPort";
import { interactionJournal } from "../../canvas/interaction/journal";
import { RECONNECT_MS } from "./timing";
import "./room.css";

// The room's controls (collaboration plan §2.2–2.6): the consent dialogs (start and join), what a joiner sees while
// the room's diagram is on its way, the room chip in the top bar's save-status slot ("3 here ▾": who is here, Copy
// room link, Leave room), and the failure states, each with Retry and a file copy. Share's "Edit together…" row and
// Ctrl+K open the start dialog (src/lib/roomEntry.ts, EDIT_TOGETHER).

/**
 * The room's controls live outside the canvas (the dialogs, the chip, the joiner's wait), so they have an
 * interaction controller of their own (src/canvas/interaction): its canvas is whichever canvas-wrap is on screen.
 * Every focus handoff of theirs is an event with its cause (dialog.closed, room.waiting, room.status).
 */
const roomFocus = createInteractionController(
  createDomPort({ root: () => document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]') }),
  domScheduler,
  { journal: interactionJournal },
);
/** A room dialog closed: focus back to what opened it, else the canvas (D6). */
const dialogClosed = (opener: HTMLElement | null) =>
  roomFocus.dispatch({ type: "dialog.closed", dialog: "room", opener });

const services = () => ["tracker.openwebtorrent.com", "tracker.webtorrent.dev", "stun.cloudflare.com"].join(", ");

function useRoom(room: RoomLifecycle) {
  return useSyncExternalStore(room.subscribe, room.getSnapshot);
}

/** Re-renders on the session's changes (peers, connectivity, the document arriving). */
function useSessionState(session: CollabSession) {
  return useSyncExternalStore(
    (fn) => session.onChange(fn),
    () =>
      `${session.transport.peers().length}:${session.peers().length}:${session.connectivity}:${session.connectionFailed}:${session.hasDocument}`,
  );
}

const roomLink = (open: OpenRoom) => formatRoomLink(appBaseUrl(), open.link);

/** True once `active` has held for `ms` (false again as soon as it stops). */
function useHeld(active: boolean, ms: number): boolean {
  const [seen, setSeen] = useState({ active, held: false });
  if (seen.active !== active) setSeen({ active, held: false });
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setSeen({ active: true, held: true }), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
  return active && seen.held;
}

/** The room link to select and copy by hand, when the browser refused to copy it. */
let linkToShow: string | null = null;
const linkListeners = new Set<() => void>();
const showLink = (link: string | null) => {
  linkToShow = link;
  for (const fn of linkListeners) fn();
};
const useLinkToShow = () =>
  useSyncExternalStore(
    (fn) => (linkListeners.add(fn), () => void linkListeners.delete(fn)),
    () => linkToShow,
  );

/** Copy room link: copied (said in a toast), or, refused, the link in a dialog to select and copy. */
const copyRoomLink = (link: string) =>
  void copyText(link).then((ok) => (ok ? notify(t("collab.roomLinkCopied"), { kind: "success" }) : showLink(link)));

/** Where the room stands, as its chip and alerts say it (§2.6). */
type RoomState = "connecting" | "waiting" | "here" | "reconnecting" | "alone" | "failed";

function useRoomState(session: CollabSession): { state: RoomState; peers: number } {
  useSessionState(session);
  const peers = session.transport.peers().length;
  const left = !peers && session.hasDocument && session.connectivity === "peer-left";
  const alone = useHeld(left, RECONNECT_MS);
  const state: RoomState = session.connectionFailed
    ? "failed"
    : peers
      ? "here"
      : !session.hasDocument
        ? "connecting"
        : left
          ? alone
            ? "alone"
            : "reconnecting"
          : "waiting";
  return { state, peers };
}

const CHIP_TEXT: Record<RoomState, (peers: number) => string> = {
  connecting: () => t("collab.chipConnecting"),
  waiting: () => t("collab.chipWaiting"),
  here: (peers) => t("collab.chipHere", { count: peers + 1 }),
  reconnecting: () => t("collab.chipReconnecting"),
  alone: () => t("collab.chipAlone"),
  failed: () => t("collab.chipFailed"),
};

const LINK_PROBLEMS: Record<RoomLinkProblem, () => string> = {
  missing: () => t("collab.linkDamaged"),
  damaged: () => t("collab.linkDamaged"),
  newer: () => t("collab.linkNewer"),
  ambiguous: () => t("collab.linkAmbiguous"),
  "in-query": () => t("collab.linkInQuery"),
};

const NOTICES: Record<RoomNotice, () => string> = {
  left: () => t("collab.leftNotice"),
  private: () => t("collab.leftPrivateNotice"),
  failed: () => t("collab.openFailed"),
  "storage-full": () => t("collab.storageFull"),
};

/**
 * The dialogs: consent to start (the open diagram) or to join (a link), and a link that can't be opened. Nothing is
 * contacted before Start room or Join.
 */
export function RoomLayer({
  room,
  slug,
  canvas,
}: {
  room: RoomLifecycle;
  slug: string;
  canvas: RefObject<CanvasHandle | null>;
}) {
  useLocale();
  const snap = useRoom(room);
  useEffect(() => roomFocus.connect(), []);
  // Start room keeps its dialog through the opening, then shows the link: "pending", then the room's mount.
  const [started, setStarted] = useState<"pending" | number>();
  const shownNotice = useRef(0);
  useEffect(() => {
    const notice = snap.notice;
    if (!notice || notice.seq === shownNotice.current) return;
    shownNotice.current = notice.seq;
    notify(NOTICES[notice.kind](), { kind: notice.kind === "left" ? "info" : "error" });
  }, [snap.notice]);
  const prompt = snap.prompt;
  const link = useLinkToShow();
  if (snap.open?.unsaved) return <UnsavedDialog room={room} />;
  if (link) return <LinkDialog link={link} onClose={() => showLink(null)} />;
  if (typeof started === "number" && snap.open?.mount === started)
    return <StartedDialog open={snap.open} onClose={() => setStarted(undefined)} />;
  if (prompt?.kind === "start" || started === "pending")
    return (
      <StartDialog
        room={room}
        slug={slug}
        canvas={canvas}
        starting={started === "pending"}
        onStart={(opening) => {
          setStarted("pending");
          void opening.then((open) => setStarted(open?.mount));
        }}
      />
    );
  if (prompt?.kind === "join") return <JoinDialog room={room} alias={prompt.alias} />;
  if (!prompt && snap.open?.slug && snap.open.slug === slug)
    return <RoomAlert room={room} open={snap.open} canvas={canvas} />;
  if (prompt?.kind === "invalid")
    return (
      <Dialog
        restoreFocus={dialogClosed}
        title={t("collab.linkProblemTitle")}
        icon={<Glyph name="alert" />}
        onClose={() => room.dismiss()}
        testId="room-link-problem"
        width={460}
        footer={
          <>
            <span className="ix-grow" />
            <button
              className="btn btn-primary"
              onClick={() => room.dismiss()}
              data-autofocus
              data-testid="room-link-problem-ok"
            >
              {t("common.done")}
            </button>
          </>
        }
      >
        <p data-testid="room-link-problem-message">{LINK_PROBLEMS[prompt.problem]()}</p>
      </Dialog>
    );
  return null;
}

/**
 * The room disconnected but its copy couldn't be saved. Not dismissible (no Escape, backdrop or close button): the
 * canvas behind it can't change and nothing navigates, so its one document is what Save a file copy exports.
 */
function UnsavedDialog({ room }: { room: RoomLifecycle }) {
  const [failures, setFailures] = useState(0);
  // One message at a time: an earlier storage notice would point at File ▸ Save behind this modal.
  useEffect(() => toast.dismiss(), []);
  return (
    <Dialog
      restoreFocus={dialogClosed}
      title={t("collab.unsavedTitle")}
      icon={<Glyph name="alert" />}
      onClose={() => {}}
      closable={false}
      testId="room-unsaved-dialog"
      width={480}
      footer={
        <>
          <button className="btn" onClick={() => room.discardUnsaved()} data-testid="room-unsaved-discard">
            {t("collab.discardChanges")}
          </button>
          <span className="ix-grow" />
          <button
            className="btn"
            onClick={() => {
              const diagram = room.unsavedDiagram();
              if (diagram) downloadText(serializeNative(diagram), "room-copy.diagram.json", "application/json");
            }}
            data-testid="room-unsaved-file"
          >
            {t("collab.saveCopy")}
          </button>
          <button
            className="btn btn-primary"
            data-autofocus
            onClick={() => !room.retrySave() && setFailures((n) => n + 1)}
            data-testid="room-unsaved-retry"
          >
            {t("common.tryAgain")}
          </button>
        </>
      }
    >
      <p>{t("collab.unsavedBody")}</p>
      {failures > 0 && (
        // A new element per failure, so each one is announced.
        <p key={failures} className="ix-error" role="alert" data-testid="room-unsaved-again">
          {t("collab.unsavedAgain")}
        </p>
      )}
    </Dialog>
  );
}

function NameField({ value, onChange, testId }: { value: string; onChange: (v: string) => void; testId: string }) {
  return (
    <label className="room-name">
      <span className="ix-form-label">{t("collab.yourName")}</span>
      <input
        className="ix-input"
        value={value}
        maxLength={COLLAB_LIMITS.maxAliasChars}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        data-testid={testId}
      />
    </label>
  );
}

function StartDialog({
  room,
  slug,
  canvas,
  starting,
  onStart,
}: {
  room: RoomLifecycle;
  slug: string;
  canvas: RefObject<CanvasHandle | null>;
  starting: boolean;
  onStart: (opening: Promise<OpenRoom | undefined>) => void;
}) {
  const [alias, setAlias] = useState(() => room.suggestAlias());
  const [blocked] = useState(() => !canCollaborate({ ...getPrivacyFlags(slug), diagram: getCurrent(slug) }));
  const cancel = () => {
    if (!starting) room.dismiss();
  };
  const start = () => {
    canvas.current?.flush();
    const diagram = canvas.current?.getDiagram() ?? getCurrent(slug);
    if (!diagram) return;
    let target = resolveSlug(slug);
    // An example, a shared diagram or a blank draft becomes one of your diagrams first: the room keeps it there.
    if (!isLibrarySlug(target)) {
      try {
        target = createLibraryDiagram(diagram, undefined, undefined, { sourceSlug: slug });
      } catch {
        notify(t("collab.storageFull"), { kind: "error" });
        return;
      }
    }
    onStart(room.start({ slug: target, diagram, alias: alias.trim() || undefined }));
  };
  if (blocked)
    return (
      <Dialog
        restoreFocus={dialogClosed}
        title={t("collab.startTitle")}
        onClose={() => room.dismiss()}
        testId="room-start-dialog"
        width={480}
        footer={
          <>
            <span className="ix-grow" />
            <button
              className="btn btn-primary"
              onClick={() => room.dismiss()}
              data-autofocus
              data-testid="room-start-cancel"
            >
              {t("common.done")}
            </button>
          </>
        }
      >
        <p data-testid="room-private-off">{t("collab.privateOff")}</p>
      </Dialog>
    );
  return (
    <Dialog
      restoreFocus={dialogClosed}
      title={t("collab.startTitle")}
      subtitle={t("collab.startLead")}
      onClose={cancel}
      testId="room-start-dialog"
      width={500}
      footer={
        <>
          <span className="ix-grow" />
          <button className="btn" onClick={cancel} disabled={starting} data-testid="room-start-cancel">
            {t("common.cancel")}
          </button>
          <button className="btn btn-primary" onClick={start} disabled={starting} data-testid="room-start-confirm">
            {starting ? t("collab.starting") : t("collab.startRoom")}
          </button>
        </>
      }
    >
      <ul className="ix-privacy-list" data-testid="room-start-disclosure">
        <li>{t("collab.ipPeers")}</li>
        <li>{t("collab.ipTrackers")}</li>
        <li>{t("collab.encrypted")}</li>
      </ul>
      <NameField value={alias} onChange={setAlias} testId="room-start-alias" />
      <p className="ix-muted" data-testid="room-services">
        {t("collab.services", { list: services() })}
      </p>
    </Dialog>
  );
}

function StartedDialog({ open, onClose }: { open: OpenRoom; onClose: () => void }) {
  const [copied, setCopied] = useState<boolean | undefined>();
  const link = roomLink(open);
  return (
    <Dialog
      restoreFocus={dialogClosed}
      title={t("collab.startTitle")}
      onClose={onClose}
      testId="room-started-dialog"
      width={500}
      footer={
        <>
          <span className="ix-grow" />
          <button className="btn" onClick={onClose} data-testid="room-started-done">
            {t("common.done")}
          </button>
        </>
      }
    >
      <p role="status" data-testid="room-started-status">
        {t("collab.roomOpenWaiting")}
      </p>
      <div className="ix-field-row">
        <input
          className="ix-input ix-mono"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={t("collab.roomLink")}
          data-testid="room-link"
        />
        <button
          className="btn btn-primary"
          data-autofocus
          onClick={() => void copyText(link).then(setCopied)}
          data-testid="room-link-copy"
        >
          <Glyph name="copy" size={14} /> {copied ? t("collab.copied") : t("collab.copy")}
        </button>
      </div>
      {copied === false && <p className="ix-error">{t("collab.copyBlocked")}</p>}
      <p className="ix-muted">{t("collab.sendLink")}</p>
    </Dialog>
  );
}

function JoinDialog({ room, alias: suggested }: { room: RoomLifecycle; alias: string }) {
  const [alias, setAlias] = useState(suggested);
  return (
    <Dialog
      restoreFocus={dialogClosed}
      title={t("collab.joinTitle")}
      subtitle={t("collab.joinLead")}
      onClose={() => room.dismiss()}
      testId="room-join-dialog"
      width={500}
      footer={
        <>
          <span className="ix-grow" />
          <button className="btn" onClick={() => room.dismiss()} data-autofocus data-testid="room-join-decline">
            {t("collab.dontJoin")}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void room.accept(alias.trim() || undefined)}
            data-testid="room-join-accept"
          >
            {t("collab.join")}
          </button>
        </>
      }
    >
      <ul className="ix-privacy-list" data-testid="room-join-disclosure">
        <li>{t("collab.joinIpPeers")}</li>
        <li>{t("collab.ipTrackers")}</li>
        <li>{t("collab.encrypted")}</li>
      </ul>
      <NameField value={alias} onChange={setAlias} testId="room-join-alias" />
      <p className="ix-muted">{t("collab.unverified")}</p>
      <p className="ix-muted" data-testid="room-services">
        {t("collab.services", { list: services() })}
      </p>
    </Dialog>
  );
}

/**
 * In the top bar's save-status slot while a room is open: its state ("3 here", "Room open · waiting for others",
 * "Reconnecting…"), and a menu with who is here, Copy room link and Leave room. While a joiner connects, status only
 * (the wait in the canvas's place has Leave room, and there's no room to link yet).
 */
export function RoomChip({ room, here, onShow }: { room: RoomLifecycle; here: boolean; onShow: () => void }) {
  useLocale();
  const snap = useRoom(room);
  if (!snap.open || snap.open.unsaved) return null;
  return <OpenChip room={room} open={snap.open} here={here} onShow={onShow} />;
}

function OpenChip({
  room,
  open,
  here,
  onShow,
}: {
  room: RoomLifecycle;
  open: OpenRoom;
  here: boolean;
  onShow: () => void;
}) {
  const session = open.session;
  const { state, peers } = useRoomState(session);
  const elsewhere = !here && !!open.slug;
  const text = elsewhere
    ? t("collab.chipElsewhere", { title: session.doc.project().diagram?.title ?? "" })
    : CHIP_TEXT[state](peers);
  const data = {
    "data-testid": "room-chip",
    "data-state": elsewhere ? "elsewhere" : state,
    "data-peers": peers,
    "data-present": session.peers().length,
    "data-role": open.role,
  };
  if (state === "connecting" && !elsewhere)
    return (
      <span className="ix-shared room-chip" role="status" {...data}>
        <span className="room-dot" aria-hidden="true" />
        <span className="room-chip-text" data-testid="room-chip-text">
          {text}
        </span>
      </span>
    );
  const entries = (): MenuEntry[] => [
    { type: "section", label: t("collab.inRoom") },
    { type: "note", text: <People session={session} /> },
    { type: "separator" },
    ...(state === "failed"
      ? [{ type: "item" as const, testId: "room-retry", title: t("common.retry"), onSelect: () => room.retry() }]
      : []),
    ...(elsewhere ? [{ type: "item" as const, testId: "room-show", title: t("collab.show"), onSelect: onShow }] : []),
    {
      type: "item",
      testId: "room-copy-link",
      icon: <Glyph name="link" size={14} />,
      title: t("collab.copyRoomLink"),
      desc: t("collab.sendLink"),
      onSelect: () => copyRoomLink(roomLink(open)),
    },
    { type: "item", testId: "room-leave", title: t("collab.leave"), onSelect: () => void room.leave() },
  ];
  return (
    <Menu
      label={t("collab.roomMenu")}
      testId="room-menu"
      width={300}
      entries={entries}
      trigger={(props) => (
        <button
          type="button"
          className="ix-shared room-chip"
          aria-label={t("collab.chipLabel", { status: text })}
          {...props}
          {...data}
        >
          <span className="room-dot" aria-hidden="true" />
          {state === "here" && <span className="room-dot room-dot-peer" aria-hidden="true" />}
          <span className="room-chip-text" data-testid="room-chip-text">
            {text}
          </span>
          <Glyph name="chevron-down" size={12} />
        </button>
      )}
    />
  );
}

/** Who is here: you, then each peer by the name they gave (unverified), in their colour. */
function People({ session }: { session: CollabSession }): ReactNode {
  const me = session.me;
  return (
    // Inside a menu, so not a list (a menu holds menu items): rows of text with no role of their own.
    <div className="room-people" role="presentation" data-testid="room-people">
      <div role="presentation" data-testid="room-person-you">
        <span className="room-dot" style={{ color: PRESENCE_COLOURS[me.colour] }} aria-hidden="true" />
        {t("collab.you", { alias: me.alias })}
      </div>
      {session.peers().map((p) => (
        <div key={p.sender} role="presentation" data-testid="room-person">
          <span className="room-dot" style={{ color: PRESENCE_COLOURS[p.colour] }} aria-hidden="true" />
          {t("collab.peer", { alias: p.alias, status: p.status })}
        </div>
      ))}
    </div>
  );
}

/** The browser refused to copy: the link, selected, to copy by hand. */
function LinkDialog({ link, onClose }: { link: string; onClose: () => void }) {
  return (
    <Dialog
      // Opened from the chip's menu (which has closed by now): back to the chip.
      restoreFocus={(opener) =>
        dialogClosed(opener ?? document.querySelector<HTMLElement>('[data-testid="room-chip"]'))
      }
      title={t("collab.roomLink")}
      onClose={onClose}
      testId="room-link-dialog"
      width={500}
      footer={
        <>
          <span className="ix-grow" />
          <button className="btn" onClick={onClose} data-testid="room-link-dialog-done">
            {t("common.done")}
          </button>
        </>
      }
    >
      <p className="ix-error" role="alert">
        {t("collab.copyBlocked")}
      </p>
      <input
        className="ix-input ix-mono"
        readOnly
        value={link}
        data-autofocus
        data-autoselect
        onFocus={(e) => e.currentTarget.select()}
        aria-label={t("collab.roomLink")}
        data-testid="room-link-selectable"
      />
      <p className="ix-muted">{t("collab.sendLink")}</p>
    </Dialog>
  );
}

/**
 * The room couldn't connect (§2.6): why, Retry, and the way out that always works, a file. Announced, never a focus
 * move; Retry hands the keyboard to the room chip as the alert goes (W3).
 */
function RoomAlert({
  room,
  open,
  canvas,
}: {
  room: RoomLifecycle;
  open: OpenRoom;
  canvas: RefObject<CanvasHandle | null>;
}) {
  const { state } = useRoomState(open.session);
  if (state !== "failed") return null;
  return (
    <div className="room-alert" role="alert" data-testid="room-alert">
      <p>
        <strong>{t("collab.connectionFailed")}</strong>
        {open.session.connectivity === "ice-failed" && <> {t("collab.iceFailed")}</>}
      </p>
      <p className="ix-muted">{t("collab.fileFallback")}</p>
      <div className="room-alert-actions">
        <button
          className="btn"
          onClick={() => {
            const diagram: DiagramFile | undefined = canvas.current?.getDiagram();
            if (diagram) downloadText(serializeNative(diagram), "room-copy.diagram.json", "application/json");
          }}
          data-testid="room-alert-file"
        >
          {t("collab.saveCopy")}
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            const chip = document.querySelector<HTMLElement>('[data-testid="room-chip"]');
            if (chip) roomFocus.dispatch({ type: "room.status", state, retry: true, status: chip });
            room.retry();
          }}
          data-testid="room-alert-retry"
        >
          {t("common.retry")}
        </button>
      </div>
    </div>
  );
}

/** In the canvas's place while a joiner waits for the room's diagram: nothing of theirs is replaced meanwhile. */
export function RoomConnecting({ room }: { room: RoomLifecycle }) {
  useLocale();
  const snap = useRoom(room);
  const session = snap.open?.session;
  const region = useRef<HTMLDivElement>(null);
  // Joining removes the dialog and the canvas together: focus that fell to the page lands here instead (W1).
  useEffect(() => {
    if (region.current) roomFocus.dispatch({ type: "room.waiting", region: region.current });
  }, []);
  return (
    <div ref={region} tabIndex={-1} className="room-connecting" data-testid="room-connecting" role="status">
      <strong>{t("collab.connectingTitle")}</strong>
      <p className="ix-muted">{t("collab.connectingHint")}</p>
      {session && <ConnectingFailure room={room} session={session} region={region} />}
      <button className="btn" onClick={() => void room.leave()} data-testid="room-connecting-leave">
        {t("collab.leave")}
      </button>
    </div>
  );
}

function ConnectingFailure({
  room,
  session,
  region,
}: {
  room: RoomLifecycle;
  session: CollabSession;
  region: RefObject<HTMLDivElement | null>;
}) {
  useSessionState(session);
  // Matchmaking works but no one answers: they may have left, or a network blocks it (§2.6).
  const unanswered = useHeld(!session.connectionFailed && !session.hasDocument, RECONNECT_MS);
  if (!session.connectionFailed && !unanswered) return null;
  return (
    <div
      role="alert"
      data-testid="room-connecting-failed"
      data-reason={unanswered ? "no-answer" : session.connectivity}
    >
      <p>
        {unanswered ? t("collab.noAnswer") : t("collab.connectionFailed")}
        {!unanswered && session.connectivity === "ice-failed" && <> {t("collab.iceFailed")}</>}
      </p>
      <button
        className="btn"
        onClick={() => {
          if (region.current)
            roomFocus.dispatch({ type: "room.status", state: "failed", retry: true, status: region.current });
          room.retry();
        }}
        data-testid="room-connecting-retry"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}
