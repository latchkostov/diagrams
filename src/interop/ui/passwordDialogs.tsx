import { useId, useRef, useState } from "react";
import type { DiagramFile } from "../../model/types";
import { appBaseUrl, SHARE_WARN_LENGTH } from "../share";
import { encodeEncryptedShare, encryptedShareUrl, MIN_PASSWORD_LENGTH, WrongPasswordError } from "../shareCrypto";
import { passwordStrength } from "../passwordStrength";
import { Dialog } from "./Dialog";
import { copyText } from "./copyText";
import { Glyph } from "./glyphs";
import { toast } from "./toast";
import { PRIVATE_SHARE_MESSAGE } from "../../lib/localOnly";

// Password links (../shareCrypto.ts): one dialog makes them, one opens them. Both run WebCrypto in this
// page; the password and the decrypted diagram never leave it.

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Copy link with password…: encrypts the diagram into the link with a password the user picks. */
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
  /** A diagram that turned private (here or in another tab) gets no link: the dialog closes and says why. */
  const stillAllowed = () => {
    if (!allowed || allowed()) return true;
    onClose();
    toast.info(PRIVATE_SHARE_MESSAGE);
    return false;
  };
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const strength = passwordStrength(password);
  const ok = password.length >= MIN_PASSWORD_LENGTH;
  const hintId = useId();

  const create = async () => {
    if (!ok || busy || !stillAllowed()) return;
    setBusy(true);
    setError(undefined);
    try {
      const link = encryptedShareUrl(await encodeEncryptedShare(diagram, password), appBaseUrl());
      if (!stillAllowed()) return;
      setUrl(link);
      if (await copyText(link)) toast.success("Link with password copied. Send the password separately.");
      else toast.info("Couldn't copy automatically. Select the link and copy it.");
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title="Copy link with password"
      subtitle="The diagram is encrypted in this browser before it goes into the link."
      icon={<Glyph name="lock" />}
      onClose={onClose}
      testId="password-link-dialog"
      width={500}
      footer={
        <>
          <span className="ix-grow" />
          {url ? (
            <>
              <button className="btn" onClick={() => void copyText(url)} data-testid="password-link-copy-again">
                <Glyph name="copy" size={14} /> Copy again
              </button>
              <button className="btn btn-primary" onClick={onClose} data-testid="password-link-done">
                Done
              </button>
            </>
          ) : (
            <>
              <button className="btn" onClick={onClose} data-testid="password-link-cancel">
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void create()}
                disabled={!ok || busy}
                data-testid="password-link-copy"
              >
                <Glyph name={busy ? "spinner" : "copy"} size={14} /> {busy ? "Encrypting…" : "Copy link"}
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
        <label className="ix-password-field">
          <span className="ix-form-label">Password</span>
          <span className="ix-field-row">
            <input
              className="ix-input"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setUrl(undefined);
              }}
              autoComplete="new-password"
              spellCheck={false}
              minLength={MIN_PASSWORD_LENGTH}
              aria-describedby={hintId}
              data-autofocus
              data-testid="password-link-input"
            />
          </span>
        </label>
        <div className="ix-meta-row">
          <span
            id={hintId}
            className={`ix-strength is-${password ? strength.level : "empty"}`}
            data-level={password ? strength.level : "empty"}
            data-testid="password-link-strength"
          >
            {password ? strength.hint : `At least ${MIN_PASSWORD_LENGTH} characters. Several random words work well.`}
          </span>
          <span className="ix-grow" />
          <label className="ix-check">
            <input
              type="checkbox"
              checked={show}
              onChange={(e) => setShow(e.target.checked)}
              data-testid="password-link-show"
            />
            Show
          </label>
        </div>
      </form>
      {url && (
        <>
          <input
            className="ix-input ix-mono"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Link with password"
            data-testid="password-link-url"
          />
          {url.length > SHARE_WARN_LENGTH && (
            <div className="ix-callout ix-callout-warn" data-testid="password-link-long">
              <Glyph name="alert" size={15} />
              <span>This link is long. Some chat apps and email clients cut long links off.</span>
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
        <span>
          <strong>Send the password separately.</strong> Anyone with the link and the password can open it. Nothing is
          uploaded, and a forgotten password can't be recovered.
        </span>
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
      setError(message(err));
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
      title="This diagram is password-protected"
      subtitle="Enter the password you were given. It's checked in this browser; nothing is sent anywhere."
      icon={<Glyph name="lock" />}
      onClose={onClose}
      testId="password-prompt"
      width={460}
      footer={
        <>
          <span className="ix-grow" />
          <button className="btn" onClick={onClose} data-testid="password-prompt-cancel">
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={!password || busy}
            data-testid="password-prompt-submit"
          >
            {busy && <Glyph name="spinner" size={14} />} {busy ? "Unlocking…" : "Open"}
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
          aria-label="Password"
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
