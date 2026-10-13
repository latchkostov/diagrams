import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SHARE_LINKS } from "../../lib/deployment";
import { DIAGRAMS_CHANGED } from "../../lib/diagramIO";
import type { Privacy } from "../../lib/localOnly";
import { Dialog } from "./Dialog";
import { Glyph, type GlyphName } from "./glyphs";
import "./shareChooser.css";

// File ▸ Share… (and the right-click's Export ▸ Share…, Ctrl+K): every way a diagram leaves the app, each saying who
// can open what it makes, safest first (docs/UX-PRINCIPLES.md, "Who can open it"). Picking one hands over to the
// dialog that already does it (Interactive HTML, Embed code, Link with password, Share link) or saves the file.
// The public ones (anyone with the link can open what they make) sit last, folded behind one more step, and never
// take the keyboard first. A private diagram lists only what it allows; a copy built without share links
// (src/lib/deployment.ts) has no link rows and no public section at all.

export type EmbedScope = "private" | "public";

export interface ShareChooserProps {
  /** The diagram's privacy, read at each render: it can change while the chooser is open (here or in another tab). */
  privacy: () => Privacy;
  onHtml: () => void;
  onFile: () => void;
  onEmbed: (scope: EmbedScope) => void;
  onPasswordLink: () => void;
  onShareLink: () => void;
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
  onMakeNotPrivate,
  onClose,
}: ShareChooserProps) {
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
  // A row that went away with the keyboard on it (the diagram turned private): the first row takes it, not the page.
  useLayoutEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || !active.isConnected)
      list.current?.querySelector<HTMLElement>("[data-share-row]")?.focus();
  });

  return (
    <Dialog
      title="Share"
      subtitle="Safest first. Each says who can open what it makes."
      icon={<Glyph name="share" />}
      onClose={onClose}
      testId="share-chooser"
      width={540}
    >
      <div ref={rowKeys} className="ix-share-list" role="group" aria-label="Ways to share">
        <div ref={list} className="ix-share-group" data-testid="share-safe">
          <Option
            testId="share-option-html"
            icon="play"
            title="Interactive HTML…"
            desc="Anyone who has this file can open it. A password is optional."
            hint=".html"
            onPick={onHtml}
            first
          />
          <Option
            testId="share-option-file"
            icon="json"
            title="Diagram file"
            desc="Anyone who has this file can open and edit it."
            hint=".diagram.json"
            onPick={onFile}
          />
          <Option
            testId="share-option-embed"
            icon="code"
            title="Embed in your app…"
            desc="Your app supplies it (private): the diagram never leaves your app."
            onPick={() => onEmbed("private")}
          />
          {links && (
            <Option
              testId="share-option-password"
              icon="lock"
              title="Link with password…"
              desc="Only people with the password can open it."
              onPick={onPasswordLink}
            />
          )}
        </div>
        {SHARE_LINKS && privacy && (
          <p className="ix-share-note" data-testid="share-private-note">
            <Glyph name="lock" size={13} />
            {privacy === "private" ? (
              <span>
                Links and public embeds are off for a private diagram.{" "}
                <button
                  type="button"
                  className="link-btn"
                  onClick={onMakeNotPrivate}
                  data-share-row
                  data-testid="share-make-not-private"
                >
                  Make it not private…
                </button>
              </span>
            ) : (
              <span>Links and public embeds are off: this diagram is always private.</span>
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
              <span>
                <strong>Public link or embed</strong> · anyone with the link can open it
              </span>
            </button>
            {publicOpen && (
              <div id={publicId} className="ix-share-group" data-testid="share-public-options">
                <Option
                  testId="share-option-link"
                  icon="link"
                  title="Share link…"
                  desc={
                    <>
                      <strong>Public:</strong> anyone with the link can open it.
                    </>
                  }
                  onPick={onShareLink}
                />
                <Option
                  testId="share-option-embed-public"
                  icon="code"
                  title="Embed on a public page…"
                  desc={
                    <>
                      <strong>Public:</strong> anyone who can see the page can open it.
                    </>
                  }
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
