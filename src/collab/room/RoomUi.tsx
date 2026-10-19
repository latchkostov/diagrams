import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import type { CanvasHandle } from "../../canvas/CanvasView";
import { t, useLocale } from "../../i18n";
import { BRAND_NAME } from "../../lib/deployment";
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
import {
  createLibraryDiagram,
  getCurrent,
  getPrivacyFlags,
  isLibrarySlug,
  resolveSlug,
  withPrivacyField,
} from "../../lib/diagramIO";
import { canCollaborate } from "../../lib/localOnly";
import { COLLAB_LIMITS } from "../limits";
import { formatRoomLink, type RoomLinkProblem } from "../link";
import type { CollabSession } from "../session";
import type { OpenRoom, RoomLifecycle, RoomNotice } from "./lifecycle";
import { createInteractionController } from "../../canvas/interaction/controller";
import { createDomPort, domScheduler } from "../../canvas/interaction/domPort";
import { interactionJournal } from "../../canvas/interaction/journal";
import { RECONNECT_MS } from "./timing";
import { hasTrackers, roomEndpoints, serviceHosts } from "./endpoints";
import { roomWatch, type Prompt, type WatchState, type WatchTogether } from "./watch";
import { rolesOf } from "./roles";
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

/** What a room contacts, as the consent dialogs name it: this build's trackers and ICE servers, by host. */
const services = () => serviceHosts(roomEndpoints()).join(", ");

function useRoom(room: RoomLifecycle) {
  return useSyncExternalStore(room.subscribe, room.getSnapshot);
}

/** Re-renders on the session's changes (peers, connectivity, the document arriving). */
function useSessionState(session: CollabSession) {
  return useSyncExternalStore(
    (fn) => session.onChange(fn),
    () =>
      `${session.transport.peers().length}:${session.peers().length}:${session.connectivity}:${session.connectionFailed}:${session.hasDocument}:${session.noAnswer}`,
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

/** The top bar's bottom edge (it wraps onto more rows on narrow screens): what floats over the canvas starts below it. */
function useToolbarBottom(): number {
  return useSyncExternalStore(
    (fn) => {
      window.addEventListener("resize", fn);
      return () => window.removeEventListener("resize", fn);
    },
    () => document.querySelector('[data-testid="topbar"]')?.getBoundingClientRect().bottom ?? 52,
  );
}

/**
 * Save a file copy, whatever is on screen: the room's canvas (what you see), else the room's document, else the copy
 * kept in Your diagrams (Private if the entry is).
 */
function saveRoomCopy(open: OpenRoom, canvas: RefObject<CanvasHandle | null>) {
  const kept = open.slug ? getCurrent(open.slug) : undefined;
  const diagram: DiagramFile | undefined =
    canvas.current?.getDiagram() ??
    open.session.doc.project().diagram ??
    (kept && open.slug ? withPrivacyField(kept, !!getPrivacyFlags(open.slug).private) : undefined);
  if (diagram) downloadText(serializeNative(diagram), "room-copy.diagram.json", "application/json");
}

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
  failed: () => (hasTrackers() ? t("collab.chipFailed") : t("collab.chipNoServers")),
};

/** Why nothing can connect, when this build names no tracker: said plainly, with the fix for whoever runs it. */
const noServers = () => t("collab.noServers", { app: BRAND_NAME });

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
export function RoomLayer(props: {
  room: RoomLifecycle;
  slug: string;
  canvas: RefObject<CanvasHandle | null>;
  /** The diagram view is on screen (not Stencils or the Lab): the alert sits over the room's canvas only. */
  canvasShown: boolean;
}) {
  return (
    <>
      <RoomLayerMain {...props} />
      <WatchLayer />
      <ViewOnlyNotice room={props.room} />
    </>
  );
}

/** A signed room's viewer tried to edit: their change was undone (the editor refused it), and a toast says why. */
function ViewOnlyNotice({ room }: { room: RoomLifecycle }): ReactNode {
  const editor = useRoom(room).open?.editor;
  useEffect(() => {
    if (!editor) return;
    let seen = editor.refusalOccurrence;
    const stop = editor.onChange(() => {
      if (editor.refusalOccurrence === seen) return;
      seen = editor.refusalOccurrence;
      if (editor.refusal === "view-only") notify(t("collab.refusedViewOnly"), { kind: "error" });
    });
    return () => void stop();
  }, [editor]);
  return null;
}

function RoomLayerMain({
  room,
  slug,
  canvas,
  canvasShown,
}: {
  room: RoomLifecycle;
  slug: string;
  canvas: RefObject<CanvasHandle | null>;
  canvasShown: boolean;
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
  if (!prompt && canvasShown && snap.open?.ready && snap.open.slug && snap.open.slug === slug)
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
        {hasTrackers() ? t("collab.services", { list: services() }) : noServers()}
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
        {hasTrackers() ? t("collab.services", { list: services() }) : noServers()}
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
  return (
    <>
      <OpenChip room={room} open={snap.open} here={here} onShow={onShow} />
      <RoomAnnouncer session={snap.open.session} />
    </>
  );
}

/**
 * The chip is a button now, so what changes in the room is said here, quietly: the room's state as it changes, who
 * joined or left ("Heron left"), and following the host's Live. Never a focus move or a toast.
 */
function RoomAnnouncer({ session }: { session: CollabSession }) {
  const { state, peers } = useRoomState(session);
  const [note, setNote] = useState("");
  useEffect(() => {
    let known = new Map(session.peers().map((p) => [p.sender, p.alias]));
    return session.onChange(() => {
      const now = new Map(session.peers().map((p) => [p.sender, p.alias]));
      const joined = [...now].filter(([id]) => !known.has(id)).map(([, alias]) => t("collab.joined", { alias }));
      const left = [...known].filter(([id]) => !now.has(id)).map(([, alias]) => t("collab.left", { alias }));
      known = now;
      if (joined.length || left.length) setNote([...joined, ...left].join(" "));
    });
  }, [session]);
  // Following the host's Live: its phase as it changes (joining, catching up, following, their connection dropped).
  const watching = useWatch().state;
  const following = followingAnnouncement(watching);
  // A signed room: this person's editing changing (let edit, or viewing).
  const canEdit = watching?.signed ? watching.canEdit : undefined;
  const lastCanEdit = useRef(canEdit);
  useEffect(() => {
    const was = lastCanEdit.current;
    lastCanEdit.current = canEdit;
    if (was === undefined || canEdit === undefined || was === canEdit) return;
    setNote(canEdit ? t("collab.nowEditing") : t("collab.youViewOnly"));
  }, [canEdit]);
  return (
    <span className="sr-only" role="status" data-testid="room-announce">
      {CHIP_TEXT[state](peers)}
      {note && `. ${note}`}
      {following && `. ${following}`}
    </span>
  );
}

const noSubscribe = () => () => {};

/** Watch together for the open room (the room owns it: ./watch.ts bindWatch): the host's show, and following. */
function useWatch(): { watch?: WatchTogether; state?: WatchState } {
  const watch = useSyncExternalStore(roomWatch.subscribe, roomWatch.get);
  const state = useSyncExternalStore(watch?.subscribe ?? noSubscribe, () => watch?.getState());
  return { watch, state };
}

/** What's said (quietly) as following changes: its phase, not every step of a catch-up. */
function followingAnnouncement(w: WatchState | undefined): string {
  const f = w?.following;
  if (!f) return "";
  const alias = w.host?.alias ?? "";
  return f.phase === "catching-up" ? t("collab.announceCatchingUp", { alias }) : (followingText(w) ?? "");
}

/** The chip's words while following the host's Live, else undefined. */
function followingText(w: WatchState | undefined): string | undefined {
  const f = w?.following;
  if (!f) return undefined;
  const alias = w.driver?.alias ?? "";
  const seconds = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
  switch (f.phase) {
    case "joining":
      return t("collab.chipJoining", { alias });
    case "catching-up":
      return t("collab.chipCatchingUp", { at: seconds(f.progress?.at ?? 0), of: seconds(f.progress?.of ?? 0) });
    case "host-dropped":
      return t("collab.chipHostDropped", { alias });
    default:
      return t("collab.chipFollowing", { alias });
  }
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
  const { watch, state: watching } = useWatch();
  const elsewhere = !here && !!open.slug;
  const text = elsewhere
    ? t("collab.chipElsewhere", { title: session.doc.project().diagram?.title ?? "" })
    : (followingText(watching) ?? CHIP_TEXT[state](peers));
  const data = {
    "data-testid": "room-chip",
    "data-state": elsewhere ? "elsewhere" : state,
    "data-peers": peers,
    "data-present": session.peers().length,
    "data-role": open.role,
    // Watch together: following the host's Live (its phase), hosting, or neither.
    "data-watch":
      watching?.following?.phase ??
      (watching?.hosting ? "host" : watching?.driving ? "driving" : watching?.show ? "offered" : "none"),
    // Hosts and requests: this person's roles (the host, a co-host; driving Live).
    "data-host": watching?.hosting ? "true" : watching?.cohosting ? "cohost" : "false",
    "data-driving": watching?.driving ? "true" : "false",
    // Signed rooms (P4): whether this is one, and whether this person can edit there.
    "data-signed": watching?.signed ? "true" : "false",
    "data-can-edit": watching?.canEdit === false ? "false" : "true",
    // For diagnostics (the Nightly network smoke classifies a failure by it): never shown.
    "data-connectivity": session.connectivity,
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
  const retry = () => {
    // A joiner without the room's diagram goes back to its wait (the chip turns to status only): the wait keeps the
    // keyboard. Otherwise the chip does (W3).
    const status = session.hasDocument
      ? document.querySelector<HTMLElement>('[data-testid="room-chip"]')
      : document.querySelector<HTMLElement>('[data-testid="room-connecting"]');
    if (status) roomFocus.dispatch({ type: "room.status", state, retry: true, status });
    room.retry();
  };
  const entries = (): MenuEntry[] => [
    { type: "section", label: t("collab.inRoom") },
    { type: "note", text: <People session={session} watching={watching} /> },
    // A signed room's viewer: what they can do, and who can change it.
    ...(watching?.signed && !watching.canEdit ? [{ type: "note" as const, text: t("collab.youViewOnly") }] : []),
    // The host (and, in a signed room, a co-host) acts on each person: their own row, with a menu of what they can do.
    ...(watch && watching && (watching.hosting || watching.lead) ? personEntries(watch, watching, session) : []),
    ...(watch && watching?.signed && watching.lead
      ? [
          {
            type: "item" as const,
            testId: "room-new-view-only",
            title: t("collab.newViewOnly"),
            checkbox: true,
            checked: watching.viewOnly,
            onSelect: () => watch.setViewOnly(!watching.viewOnly),
          },
        ]
      : []),
    { type: "separator" },
    ...(state === "failed"
      ? [{ type: "item" as const, testId: "room-retry", title: t("common.retry"), onSelect: retry }]
      : []),
    ...(elsewhere ? [{ type: "item" as const, testId: "room-show", title: t("collab.show"), onSelect: onShow }] : []),
    ...watchEntries(watch, watching),
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
          aria-label={t("collab.chipLabel", {
            status: watching?.signed && !watching.canEdit ? `${text} · ${t("collab.roleViewing")}` : text,
          })}
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

/**
 * Watch together's rows in the chip's menu: watch the driver's Live, or (following) ask to drive, stop, and follow
 * their view; with your own Live, show it to the room.
 */
function watchEntries(watch: WatchTogether | undefined, w: WatchState | undefined): MenuEntry[] {
  if (!watch || !w || w.driving) return [];
  const alias = w.driver?.alias ?? "";
  // Following (a host who let someone drive too): stop, and follow their view; others can ask to drive.
  if (w.following)
    return [
      ...(w.hosting
        ? []
        : [
            {
              type: "item" as const,
              testId: "room-ask-drive",
              title: w.asked === "drive" ? t("collab.askedToDrive") : t("collab.askToDrive"),
              disabled: !!w.asked,
              onSelect: () => watch.askToDrive(),
            },
          ]),
      { type: "item", testId: "room-watch-stop", title: t("collab.watchStop"), onSelect: () => watch.watchOnMyOwn() },
      {
        type: "item",
        testId: "room-follow-view",
        title: t("collab.followView", { alias }),
        checked: w.followView,
        checkbox: true,
        onSelect: () => watch.setFollowView(!w.followView),
      },
      { type: "separator" },
    ];
  const entries: MenuEntry[] = [];
  if (w.show)
    entries.push({
      type: "item",
      testId: "room-watch",
      title: t("collab.watchMenu", { alias }),
      onSelect: () => watch.watch(),
    });
  if (watch.canShow && !w.hosting)
    entries.push({
      type: "item",
      testId: "room-show-live",
      title: w.asked === "show" ? t("collab.askedToShow") : t("collab.showToRoom"),
      disabled: !!w.asked,
      onSelect: () => watch.showToRoom(),
    });
  return entries.length ? [...entries, { type: "separator" }] : [];
}

/**
 * The host's row per person: their roles, and a menu (co-host, drive, host). In a signed room a co-host has it too
 * (Make host stays the host's), and someone who can only view can be let edit.
 */
function personEntries(watch: WatchTogether, w: WatchState, session: CollabSession): MenuEntry[] {
  return session.peers().map((p) => {
    const roles = rolesOf(w.roster, p.sender);
    const viewing = w.viewers.includes(p.sender);
    return {
      type: "item" as const,
      testId: "room-person-row",
      title: p.alias,
      desc: roleWords({ ...roles, viewing }),
      submenuTestId: "room-person-menu",
      submenu: (): MenuEntry[] => [
        ...(viewing
          ? [
              {
                type: "item" as const,
                testId: "room-let-edit",
                title: t("collab.letEdit"),
                onSelect: () => watch.letEdit(p.sender),
              },
            ]
          : []),
        // The host is never a co-host: a co-host's menu for them has no co-host row.
        ...(roles.host
          ? []
          : [
              roles.cohost
                ? {
                    type: "item" as const,
                    testId: "room-remove-cohost",
                    title: t("collab.removeCohost"),
                    onSelect: () => watch.setCohost(p.sender, false),
                  }
                : {
                    type: "item" as const,
                    testId: "room-make-cohost",
                    title: t("collab.makeCohost"),
                    onSelect: () => watch.setCohost(p.sender, true),
                  },
            ]),
        roles.driving
          ? { type: "item", testId: "room-take-back", title: t("collab.takeBack"), onSelect: () => watch.takeBack() }
          : {
              type: "item",
              testId: "room-let-drive",
              title: t("collab.letDrive"),
              onSelect: () => watch.letDrive(p.sender),
            },
        ...(w.hosting
          ? [
              {
                type: "item" as const,
                testId: "room-make-host",
                title: t("collab.makeHost"),
                onSelect: () => watch.makeHost(p.sender),
              },
            ]
          : []),
      ],
    };
  });
}

/** "host · driving": a person's roles in words (a signed room's viewer: "can view"). */
function roleWords(roles: { host: boolean; cohost: boolean; driving: boolean; viewing?: boolean }): string {
  return [
    roles.host && t("collab.roleHost"),
    roles.cohost && t("collab.roleCohost"),
    roles.driving && t("collab.roleDriving"),
    roles.viewing && t("collab.roleViewing"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Who is here: you, then each peer by the name they gave (unverified), in their colour. */
function People({ session, watching }: { session: CollabSession; watching?: WatchState }): ReactNode {
  // Names and statuses change without the count changing: its own subscription.
  useSyncExternalStore(
    (fn) => session.onChange(fn),
    () => session.presenceRevision,
  );
  const me = session.me;
  const roster = watching?.roster;
  const mine =
    roster && roleWords({ ...rolesOf(roster, session.senderId), viewing: !!watching?.signed && !watching.canEdit });
  return (
    // Inside a menu, so not a list (a menu holds menu items): rows of text with no role of their own.
    <div className="room-people" role="presentation" data-testid="room-people">
      <div role="presentation" data-testid="room-person-you">
        <span className="room-dot" style={{ color: PRESENCE_COLOURS[me.colour] }} aria-hidden="true" />
        {t("collab.you", { alias: me.alias })}
        {mine && ` · ${mine}`}
      </div>
      {session.peers().map((p) => {
        const roles =
          roster && roleWords({ ...rolesOf(roster, p.sender), viewing: !!watching?.viewers.includes(p.sender) });
        return (
          <div
            key={p.sender}
            role="presentation"
            data-testid="room-person"
            data-viewing={watching?.viewers.includes(p.sender) ? "true" : "false"}
          >
            <span className="room-dot" style={{ color: PRESENCE_COLOURS[p.colour] }} aria-hidden="true" />
            {t("collab.peer", { alias: p.alias, status: p.status })}
            {roles && ` · ${roles}`}
          </div>
        );
      })}
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
  const top = useToolbarBottom();
  if (state !== "failed") return null;
  return (
    <div className="room-alert" role="alert" data-testid="room-alert" style={{ insetBlockStart: top + 8 }}>
      {hasTrackers() ? (
        <p>
          <strong>{t("collab.connectionFailed")}</strong>
          {open.session.connectivity === "ice-failed" && <> {t("collab.iceFailed")}</>}
        </p>
      ) : (
        <p data-testid="room-no-servers">
          <strong>{noServers()}</strong> {t("collab.noServersHint")}
        </p>
      )}
      <p className="ix-muted">{t("collab.fileFallback")}</p>
      <div className="room-alert-actions">
        <button className="btn" onClick={() => saveRoomCopy(open, canvas)} data-testid="room-alert-file">
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
    <div
      ref={region}
      tabIndex={-1}
      className="room-connecting"
      data-testid="room-connecting"
      data-connectivity={session?.connectivity}
      role="status"
    >
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
  // Matchmaking works but no one answers: they may have left, or a network blocks it (§2.6). The session times each
  // attempt (Retry starts a fresh wait).
  const unanswered = session.noAnswer;
  if (!session.connectionFailed && !unanswered) return null;
  const servers = hasTrackers();
  return (
    <div
      role="alert"
      data-testid="room-connecting-failed"
      data-reason={!servers ? "no-trackers" : unanswered ? "no-answer" : session.connectivity}
    >
      {!servers ? (
        <p data-testid="room-no-servers">
          {noServers()} {t("collab.noServersHint")}
        </p>
      ) : (
        <p>
          {unanswered ? t("collab.noAnswer") : t("collab.connectionFailed")}
          {!unanswered && session.connectivity === "ice-failed" && <> {t("collab.iceFailed")}</>}
        </p>
      )}
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

/**
 * Watch together's in-room surfaces: the host's (and co-hosts') request cards under the chip, never taking focus or
 * the keyboard; and "Sam is driving" where a follower used the inert live bar.
 */
function WatchLayer(): ReactNode {
  useLocale();
  const { watch, state } = useWatch();
  if (!watch || !state) return null;
  return (
    <>
      {state.prompts.length > 0 && <RequestCards watch={watch} prompts={state.prompts} />}
      {state.inert && state.following && <DrivingPopover watch={watch} state={state} at={state.inert} />}
    </>
  );
}

/** The request cards under the chip (the toolbar measured only while there are some). */
function RequestCards({ watch, prompts }: { watch: WatchTogether; prompts: Prompt[] }) {
  const top = useToolbarBottom();
  return (
    <div className="room-prompts" style={{ insetBlockStart: top + 8 }}>
      {prompts.map((p) => (
        <RequestCard key={p.from} prompt={p} onAnswer={(yes) => watch.answer(p, yes)} />
      ))}
    </div>
  );
}

function RequestCard({ prompt, onAnswer }: { prompt: Prompt; onAnswer: (yes: boolean) => void }) {
  const drive = prompt.what === "drive";
  return (
    <div className="room-prompt" role="status" data-testid={drive ? "room-prompt-drive" : "room-prompt-show"}>
      <p>
        {drive
          ? t("collab.promptDrive", { alias: prompt.alias })
          : t("collab.promptShow", { alias: prompt.alias, title: prompt.title ?? "" })}
      </p>
      <div className="room-alert-actions">
        <button className="btn" onClick={() => onAnswer(false)} data-testid="room-prompt-decline">
          {t("collab.notNow")}
        </button>
        <button className="btn btn-primary" onClick={() => onAnswer(true)} data-testid="room-prompt-accept">
          {drive ? t("collab.letThem") : t("collab.showEveryone")}
        </button>
      </div>
    </div>
  );
}

/** "Sam is driving.", where the follower used the live bar: Ask to drive, or watch on their own. */
function DrivingPopover({
  watch,
  state,
  at,
}: {
  watch: WatchTogether;
  state: WatchState;
  at: { x: number; y: number };
}) {
  const card = useRef<HTMLDivElement>(null);
  // Where it fits: above what was used, within the viewport (measured once it's drawn).
  const [place, setPlace] = useState<{ left: number; top: number }>({ left: at.x, top: Math.max(8, at.y - 96) });
  useLayoutEffect(() => {
    const el = card.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.min(Math.max(8, at.x), window.innerWidth - width - 8);
    const top = Math.min(Math.max(8, at.y - height - 8), window.innerHeight - height - 8);
    setPlace({ left: Math.max(8, left), top: Math.max(8, top) });
  }, [at.x, at.y]);
  useEffect(() => {
    // Focus comes in, and goes back to what had it (else the canvas) when it closes with focus still inside.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = card.current;
    el?.querySelector<HTMLElement>("button")?.focus();
    const away = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !card.current?.contains(e.target as Node))
        watch.dismissInert();
    };
    document.addEventListener("keydown", away);
    document.addEventListener("pointerdown", away);
    return () => {
      document.removeEventListener("keydown", away);
      document.removeEventListener("pointerdown", away);
      const lost =
        !document.activeElement || document.activeElement === document.body || el?.contains(document.activeElement);
      if (!lost) return;
      if (opener && opener !== document.body && opener.isConnected) opener.focus();
      else document.querySelector<HTMLElement>('[data-testid="canvas-wrap"]')?.focus({ preventScroll: true });
    };
  }, [watch]);
  return (
    <div
      ref={card}
      className="room-driving"
      role="dialog"
      aria-label={t("collab.isDriving", { alias: state.driver?.alias ?? "" })}
      data-testid="room-driving"
      style={{ top: place.top, left: place.left }}
    >
      <p>{t("collab.isDriving", { alias: state.driver?.alias ?? "" })}</p>
      <div className="room-alert-actions">
        <button className="btn" onClick={() => watch.watchOnMyOwn()} data-testid="room-driving-own">
          {t("collab.watchStop")}
        </button>
        <button
          className="btn btn-primary"
          disabled={!!state.asked}
          onClick={() => watch.askToDrive()}
          data-testid="room-driving-ask"
        >
          {state.asked ? t("collab.askedToDrive") : t("collab.askToDrive")}
        </button>
      </div>
    </div>
  );
}
