import { tRich } from "../../i18n/rich";
import { t, useLocale } from "../../i18n";
import { useEffect, useId, useRef, useState } from "react";
import type { DiagramFile } from "../../model/types";
import { appBaseUrl, SHARE_WARN_LENGTH } from "../share";
import { encodeEncryptedShare, encryptedShareUrl, MIN_PASSWORD_LENGTH, WrongPasswordError } from "../shareCrypto";
import { PasswordField } from "./PasswordField";
import { Dialog } from "./Dialog";
import { copyText } from "./copyText";
import { Glyph } from "./glyphs";
import { toast } from "./toast";

// Password links (../shareCrypto.ts): one dialog makes them, one opens them. Both run WebCrypto in this
// page; the password and the decrypted diagram never leave it.

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Share… ▸ Link with password…: encrypts the diagram into the link with a password the user picks. */
export function PasswordLinkDialog({
  diagram,
  allowed,
  onClose,
}: {
  diagram: DiagramFile;
  /** Whether its document may still be shared as a link: asked before encrypting and again before showing. */
  allowed?: () => boolean;
  onClose: () => void;
}) {
  useLocale();
  /** A diagram that turned private (here or in another tab) gets no link: the dialog closes and says why. */
  const stillAllowed = () => {
    if (!allowed || allowed()) return true;
    onClose();
    toast.info(t("fileToast.privateLink"));
    return false;
  };
  const [password, setPassword] = useState("");
  // Each link is bound to the exact password it was encrypted with. An edit (or closing the dialog) makes
  // any encryption still running stale: its link is never shown or copied.
  const [request, setRequest] = useState<{ id: number; password: string }>();
  const [made, setMade] = useState<{ password: string; url: string }>();
  const [error, setError] = useState<string>();
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current++;
    },
    [],
  );
  const busy = request?.password === password;
  const url = made?.password === password ? made.url : undefined;
  // Copy link gives way to Copy again and Done: focus goes to Done, not the page, when the button it was on goes.
  const done = useRef<HTMLButtonElement>(null);
  const hasUrl = !!url;
  useEffect(() => {
    const el = document.activeElement;
    if (hasUrl && (!el || el === document.body)) done.current?.focus();
  }, [hasUrl]);
  const ok = password.length >= MIN_PASSWORD_LENGTH;

  const create = async () => {
    if (!ok || busy || !stillAllowed()) return;
    const id = ++latest.current;
    const pw = password;
    setRequest({ id, password: pw });
    setError(undefined);
    let link: string;
    try {
      link = encryptedShareUrl(await encodeEncryptedShare(diagram, pw), appBaseUrl());
    } catch (err) {
      if (latest.current === id) {
        setRequest(undefined);
        setError(message(err));
      }
      return;
    }
    if (latest.current !== id) return;
    setRequest(undefined);
    // Encrypting takes a moment: the diagram may have become private since (here or in another tab).
    if (!stillAllowed()) return;
    setMade({ password: pw, url: link });
    if (await copyText(link)) toast.success(t("passwordLink.linkWithPasswordCopiedSendThePassword"));
    else toast.info(t("fileDialog.couldntCopyAutomaticallySelectTheLinkAnd"));
  };

  return (
    <Dialog
      title={t("passwordLink.linkWithPassword")}
      subtitle={t("passwordLink.theDiagramIsEncryptedInThisBrowser")}
      icon={<Glyph name="lock" />}
      onClose={onClose}
      testId="password-link-dialog"
      width={500}
      footer={
        <>
          <span className="ix-grow" />
          {url ? (
            <>
              <button
                className="btn"
                onClick={() => {
                  if (stillAllowed()) void copyText(url);
                }}
                data-testid="password-link-copy-again"
              >
                <Glyph name="copy" size={14} /> {t("passwordLink.copyAgain")}
              </button>
              <button ref={done} className="btn btn-primary" onClick={onClose} data-testid="password-link-done">
                {t("common.done")}
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onClose} data-testid="password-link-cancel">
                {t("common.cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void create()}
                disabled={!ok || busy}
                data-testid="password-link-copy"
              >
                <Glyph name={busy ? "spinner" : "copy"} size={14} />{" "}
                {busy ? t("passwordLink.encrypting") : t("fileDialog.copyLink")}
              </button>
            </>
          )}
        </>
      }
    >
      <form
        className="ix-password"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <PasswordField
          value={password}
          onChange={(value) => {
            latest.current++;
            setRequest(undefined);
            setError(undefined);
            setPassword(value);
          }}
          testId="password-link"
          firstFocus
        />
      </form>
      {url && (
        <>
          <input
            className="ix-input ix-mono"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label={t("passwordLink.linkWithPassword")}
            data-testid="password-link-url"
          />
          {url.length > SHARE_WARN_LENGTH && (
            <div className="ix-callout ix-callout-warn" data-testid="password-link-long">
              <Glyph name="alert" size={15} />
              <span>{t("passwordLink.thisLinkIsLongSomeChatApps")}</span>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="ix-error" role="alert" data-testid="password-link-error">
          {error}
        </p>
      )}
      <div className="ix-callout" data-testid="password-link-note">
        <Glyph name="info" size={15} />
        <span>{tRich("passwordLink.note", { b: (chunks) => <strong>{chunks}</strong> })}</span>
      </div>
    </Dialog>
  );
}

/**
 * Asks for a password link's password. `unlock` decrypts and opens; a WrongPasswordError keeps the dialog
 * open with a clear message so the user can try again. Used by the app and by embeds.
 */
export function UnlockDialog({
  unlock,
  onClose,
}: {
  unlock: (password: string) => Promise<void>;
  onClose: () => void;
}) {
  useLocale();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const submit = async () => {
    if (!password || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await unlock(password);
    } catch (err) {
      setError(err instanceof WrongPasswordError ? t("passwordLink.wrongPassword") : message(err));
      setBusy(false);
      // Wrong password: keep it, selected, so a typo can be fixed or the whole thing retyped.
      if (err instanceof WrongPasswordError)
        requestAnimationFrame(() => {
          input.current?.focus();
          input.current?.select();
        });
    }
  };

  return (
    <Dialog
      title={t("passwordLink.thisDiagramIsPasswordprotected")}
      subtitle={t("passwordLink.enterThePasswordYouWereGivenIts")}
      icon={<Glyph name="lock" />}
      onClose={onClose}
      testId="password-prompt"
      width={460}
      footer={
        <>
          <span className="ix-grow" />
          <button className="btn" onClick={onClose} data-testid="password-prompt-cancel">
            {t("common.cancel")}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={!password || busy}
            data-testid="password-prompt-submit"
          >
            {busy && <Glyph name="spinner" size={14} />} {busy ? t("passwordLink.unlocking") : t("fileDialog.open")}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          className="ix-input"
          type="password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(undefined);
          }}
          ref={input}
          autoComplete="off"
          spellCheck={false}
          aria-label={t("passwordLink.password")}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          data-autofocus
          data-testid="password-prompt-input"
        />
      </form>
      {error && (
        <p className="ix-error" role="alert" id={errorId} data-testid="password-prompt-error">
          {error}
        </p>
      )}
    </Dialog>
  );
}
