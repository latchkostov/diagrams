import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { CanvasHandle } from "../../canvas/CanvasView";
import { t, useLocale } from "../../i18n";
import { appBaseUrl } from "../../interop/share";
import { copyText } from "../../interop/ui/copyText";
import { Dialog } from "../../interop/ui/Dialog";
import { Glyph } from "../../interop/ui/glyphs";
import { notify } from "../../interop/ui/toast";
import { downloadText } from "../../interop/files";
import { serializeNative } from "../../interop/native";
import { createLibraryDiagram, getCurrent, getPrivacyFlags, isLibrarySlug, resolveSlug } from "../../lib/diagramIO";
import { canCollaborate } from "../../lib/localOnly";
import { COLLAB_LIMITS } from "../limits";
import { formatRoomLink, type RoomLinkProblem } from "../link";
import type { CollabSession } from "../session";
import type { OpenRoom, RoomLifecycle, RoomNotice } from "./lifecycle";
import "./room.css";

// The room's controls while the collaboration plan's UI slice (E4) is still to come: the consent dialogs (start and
// join), what a joiner sees while the room's diagram is on its way, and a status chip in the top bar's save-status
// slot. Every word is the plan's (§2.2, §2.3, §2.6). E4 adds the Share row, Ctrl+K, the participant popover and the
// failure states' own wording.

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
  if (snap.open?.unsaved) return <UnsavedDialog room={room} />;
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
  if (prompt?.kind === "invalid")
    return (
      <Dialog
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
  const [failedAgain, setFailedAgain] = useState(false);
  return (
    <Dialog
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
            onClick={() => setFailedAgain(!room.retrySave())}
            data-testid="room-unsaved-retry"
          >
            {t("common.tryAgain")}
          </button>
        </>
      }
    >
      <p>{t("collab.unsavedBody")}</p>
      {failedAgain && (
        <p className="ix-error" role="alert" data-testid="room-unsaved-again">
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
        <li>{t("collab.joinIpTrackers")}</li>
        <li>{t("collab.joinCopy")}</li>
      </ul>
      <NameField value={alias} onChange={setAlias} testId="room-join-alias" />
      <p className="ix-muted">{t("collab.unverified")}</p>
      <p className="ix-muted" data-testid="room-services">
        {t("collab.services", { list: services() })}
      </p>
    </Dialog>
  );
}

/** In the top bar's save-status slot while a room is open: who's here, the link, and Leave. */
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
  useSessionState(open.session);
  const [copied, setCopied] = useState(false);
  const session = open.session;
  if (!here && open.slug)
    // The room goes on for another diagram: name it, and offer the way back rather than its link.
    return (
      <div className="ix-shared room-chip" role="status" data-testid="room-chip" data-state="elsewhere">
        <span className="room-dot" aria-hidden="true" />
        <span data-testid="room-chip-text">
          {t("collab.chipElsewhere", { title: session.doc.project().diagram?.title ?? "" })}
        </span>
        <button className="ix-shared-keep" onClick={onShow} data-testid="room-show">
          {t("collab.show")}
        </button>
        <button className="ix-shared-keep" onClick={() => void room.leave()} data-testid="room-leave">
          {t("collab.leave")}
        </button>
      </div>
    );
  const peers = session.transport.peers().length;
  const state = session.connectionFailed ? "failed" : peers ? "here" : !session.hasDocument ? "connecting" : "waiting";
  return (
    <div
      className="ix-shared room-chip"
      role="status"
      data-testid="room-chip"
      data-state={state}
      data-peers={peers}
      data-present={session.peers().length}
      data-role={open.role}
    >
      <span className="room-dot" aria-hidden="true" />
      <span data-testid="room-chip-text">
        {state === "failed"
          ? t("collab.chipFailed")
          : state === "here"
            ? t("collab.chipHere", { count: peers + 1 })
            : state === "connecting"
              ? t("collab.chipConnecting")
              : t("collab.chipWaiting")}
      </span>
      {state === "failed" && (
        <button className="ix-shared-keep" onClick={() => room.retry()} data-testid="room-retry">
          {t("common.retry")}
        </button>
      )}
      <button
        className="ix-shared-keep"
        onClick={() => void copyText(roomLink(open)).then(setCopied)}
        data-testid="room-copy-link"
      >
        {copied ? t("collab.copied") : t("collab.copyRoomLink")}
      </button>
      <button className="ix-shared-keep" onClick={() => void room.leave()} data-testid="room-leave">
        {t("collab.leave")}
      </button>
    </div>
  );
}

/** In the canvas's place while a joiner waits for the room's diagram: nothing of theirs is replaced meanwhile. */
export function RoomConnecting({ room }: { room: RoomLifecycle }) {
  useLocale();
  const snap = useRoom(room);
  const session = snap.open?.session;
  const region = useRef<HTMLDivElement>(null);
  // Joining removes the dialog and the canvas together: focus that fell to the page lands here instead.
  useEffect(() => {
    if (!document.activeElement || document.activeElement === document.body) region.current?.focus();
  }, []);
  return (
    <div ref={region} tabIndex={-1} className="room-connecting" data-testid="room-connecting" role="status">
      <strong>{t("collab.connectingTitle")}</strong>
      <p className="ix-muted">{t("collab.connectingHint")}</p>
      {session && <ConnectingFailure room={room} session={session} />}
      <button className="btn" onClick={() => void room.leave()} data-testid="room-connecting-leave">
        {t("collab.leave")}
      </button>
    </div>
  );
}

function ConnectingFailure({ room, session }: { room: RoomLifecycle; session: CollabSession }) {
  useSessionState(session);
  if (!session.connectionFailed) return null;
  return (
    <div role="alert" data-testid="room-connecting-failed">
      <p>{t("collab.connectionFailed")}</p>
      <button className="btn" onClick={() => room.retry()} data-testid="room-connecting-retry">
        {t("common.retry")}
      </button>
    </div>
  );
}
