import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SHARE_LINKS } from "../../lib/deployment";
import { DIAGRAMS_CHANGED } from "../../lib/diagramIO";
import { COLLABORATION_LAB, type Privacy } from "../../lib/localOnly";
import { Dialog } from "./Dialog";
import { Glyph, type GlyphName } from "./glyphs";
import { t, useLocale } from "../../i18n";
import { tRich } from "../../i18n/rich";
import "./shareChooser.css";

// File ▸ Share… (and the right-click's Export ▸ Share…, Ctrl+K): every way a diagram leaves the app, each saying who
// can open what it makes, safest first (docs/UX-PRINCIPLES.md, "Who can open it"). Picking one hands over to the
// dialog that already does it (Interactive HTML, Embed code, Link with password, Share link) or saves the file.
// The public ones (anyone with the link can open what they make) sit last, folded behind one more step, and never
// take the keyboard first. A private diagram lists only what it allows; a copy built without share links
// (src/lib/deployment.ts) has no link rows and no public section at all. Where rooms are on (COLLABORATION_LAB, for
// now), "Edit together…" follows Link with password behind its own rule: anyone with its link can edit, so it is
// never the first row and never what Enter does first.

export type EmbedScope = "private" | "public";

export interface ShareChooserProps {
  /** The diagram's privacy, read at each render: it can change while the chooser is open (here or in another tab). */
  privacy: () => Privacy;
  onHtml: () => void;
  onFile: () => void;
  onEmbed: (scope: EmbedScope) => void;
  onPasswordLink: () => void;
  onShareLink: () => void;
  /** Edit together…: the room's start dialog (its consent first). */
  onEditTogether?: () => void;
  /** Opens the Private diagram dialog (its one confirmation for Make not private). */
  onMakeNotPrivate: () => void;
  onClose: () => void;
}

function Option({
  testId,
  icon,
  title,
  desc,
  hint,
  onPick,
  first,
}: {
  testId: string;
  icon: GlyphName;
  title: string;
  desc: ReactNode;
  hint?: string;
  onPick: () => void;
  first?: boolean;
}) {
  return (
    <button
      type="button"
      className="ix-share-option"
      onClick={onPick}
      data-share-row
      data-autofocus={first || undefined}
      data-testid={testId}
    >
      <span className="ix-share-icon">
        <Glyph name={icon} size={15} />
      </span>
      <span className="ix-share-text">
        <span className="ix-share-title">{title}</span>
        <span className="ix-share-desc">{desc}</span>
      </span>
      {hint && <span className="ix-share-hint">{hint}</span>}
    </button>
  );
}

/**
 * Arrow keys (and Home, End) move between the rows; Tab still works. A native listener, because the dialog keeps
 * keys from bubbling past its panel (Dialog.tsx), so React's onKeyDown never sees them.
 */
function rowKeys(list: HTMLDivElement | null) {
  if (!list) return;
  const onKey = (e: KeyboardEvent) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const rows = [...list.querySelectorAll<HTMLElement>("[data-share-row]")];
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === "Home"
        ? 0
        : e.key === "End"
          ? rows.length - 1
          : e.key === "ArrowDown"
            ? Math.min(rows.length - 1, at + 1)
            : Math.max(0, at - 1);
    rows[next].focus();
  };
  list.addEventListener("keydown", onKey);
  return () => list.removeEventListener("keydown", onKey);
}

export function ShareChooser({
  privacy: privacyNow,
  onHtml,
  onFile,
  onEmbed,
  onPasswordLink,
  onShareLink,
  onEditTogether,
  onMakeNotPrivate,
  onClose,
}: ShareChooserProps) {
  useLocale();
  const [, rerender] = useState(0);
  // The rows follow the diagram's privacy as it changes (the switch, a paste, another tab).
  useEffect(() => {
    const changed = () => rerender((n) => n + 1);
    window.addEventListener(DIAGRAMS_CHANGED, changed);
    return () => window.removeEventListener(DIAGRAMS_CHANGED, changed);
  }, []);
  const [publicOpen, setPublicOpen] = useState(false);
  const publicId = useId();
  const list = useRef<HTMLDivElement>(null);
  const privacy = privacyNow();
  const links = SHARE_LINKS && !privacy;
  const rooms = COLLABORATION_LAB && !!onEditTogether;
  // A row that went away with the keyboard on it (the diagram turned private): the first row takes it, not the page.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected)
      list.current?.querySelector<HTMLElement>("[data-share-row]")?.focus();
  });

  return (
    <Dialog
      title={t("share.title")}
      subtitle={t("share.subtitle")}
      icon={<Glyph name="share" />}
      onClose={onClose}
      testId="share-chooser"
      width={540}
    >
      <div ref={rowKeys} className="ix-share-list" role="group" aria-label={t("share.ways")}>
        <div ref={list} className="ix-share-group" data-testid="share-safe">
          <Option
            testId="share-option-html"
            icon="play"
            title={t("share.html")}
            desc={t("share.htmlDesc")}
            hint=".html"
            onPick={onHtml}
            first
          />
          <Option
            testId="share-option-file"
            icon="json"
            title={t("share.file")}
            desc={t("share.fileDesc")}
            hint=".diagram.json"
            onPick={onFile}
          />
          <Option
            testId="share-option-embed"
            icon="code"
            title={t("share.embed")}
            desc={t("share.embedDesc")}
            onPick={() => onEmbed("private")}
          />
          {links && (
            <Option
              testId="share-option-password"
              icon="lock"
              title={t("share.password")}
              desc={t("share.passwordDesc")}
              onPick={onPasswordLink}
            />
          )}
        </div>
        {links && rooms && (
          <div className="ix-share-group ix-share-room" data-testid="share-room">
            <Option
              testId="share-option-edit-together"
              icon="users"
              title={t("share.editTogether")}
              desc={t("share.editTogetherDesc")}
              onPick={onEditTogether!}
            />
          </div>
        )}
        {SHARE_LINKS && privacy && (
          <p className="ix-share-note" data-testid="share-private-note">
            <Glyph name="lock" size={13} />
            {privacy === "private" ? (
              <span>
                {rooms ? t("share.privateOffRooms") : t("share.privateOff")}{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={onMakeNotPrivate}
                  data-share-row
                  data-testid="share-make-not-private"
                >
                  {t("share.makeNotPrivate")}
                </button>
              </span>
            ) : (
              <span>{t("share.alwaysPrivate")}</span>
            )}
          </p>
        )}
        {links && (
          <div className="ix-share-public" data-testid="share-public">
            <button
              type="button"
              className="ix-share-public-toggle"
              aria-expanded={publicOpen}
              aria-controls={publicOpen ? publicId : undefined}
              onClick={() => setPublicOpen((open) => !open)}
              data-share-row
              data-testid="share-public-toggle"
            >
              <Glyph name="chevron-right" size={12} />
              <span>{tRich("share.public", { b: (chunks) => <strong>{chunks}</strong> })}</span>
            </button>
            {publicOpen && (
              <div id={publicId} className="ix-share-group" data-testid="share-public-options">
                <Option
                  testId="share-option-link"
                  icon="link"
                  title={t("share.link")}
                  desc={tRich("share.linkDesc", { b: (chunks) => <strong>{chunks}</strong> })}
                  onPick={onShareLink}
                />
                <Option
                  testId="share-option-embed-public"
                  icon="code"
                  title={t("share.embedPublic")}
                  desc={tRich("share.embedPublicDesc", { b: (chunks) => <strong>{chunks}</strong> })}
                  onPick={() => onEmbed("public")}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
