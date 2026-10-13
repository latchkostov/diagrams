import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import { Icon } from "../../components/Icon";
import { speechServiceNote, type Dictation } from "./useDictation";

// A request box with the dictation mic and everything dictation says: "Listening…", the words heard
// so far, where the audio goes while the browser's speech service listens, and errors with how to fix them. One component, so every
// box that takes speech gives the same feedback (Advanced's describe box, the on-device model's box).

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

export interface DictationFieldTestIds {
  input: string;
  mic: string;
  interim: string;
  message: string;
  /** The standing line while the browser's speech service (not the device) listens. */
  service: string;
}

export function DictationField({
  id,
  label,
  inputRef,
  value,
  onChange,
  onKeyDown,
  placeholder,
  rows,
  disabled = false,
  dictation,
  micTitle,
  shortcut = false,
  testIds,
}: {
  id: string;
  /** The box's accessible name. */
  label: string;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  rows: number;
  disabled?: boolean;
  dictation: Dictation;
  /** Extra words for the mic's tooltip (where audio goes). */
  micTitle?: string;
  /** Ctrl+Shift+M toggles this box's mic (shown in the tooltip). */
  shortcut?: boolean;
  testIds: DictationFieldTestIds;
}) {
  const listening = dictation.status !== "idle";
  const showMic = dictation.supported && !disabled;
  const verb = listening ? "Stop dictating" : "Dictate";
  return (
    <>
      <div className={`ai-request${listening ? " is-listening" : ""}`}>
        <label className="sr-only" htmlFor={id}>
          {label}
        </label>
        <textarea
          id={id}
          ref={inputRef}
          className="ix-input ai-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={rows}
          disabled={disabled}
          spellCheck
          data-testid={testIds.input}
        />
        {showMic && (
          <button
            type="button"
            className={`ai-mic${listening ? " is-on" : ""}${dictation.hearing ? " is-hearing" : ""}`}
            onClick={() => {
              if (!listening) inputRef.current?.focus();
              dictation.toggle();
            }}
            aria-pressed={listening}
            aria-label={verb}
            title={[verb, micTitle, shortcut ? `(${MOD}+Shift+M)` : ""].filter(Boolean).join(" ")}
            data-testid={testIds.mic}
            data-status={dictation.status}
          >
            <Icon name="mic" size={15} />
          </button>
        )}
      </div>
      {(listening || dictation.interim) && (
        <p className="ai-interim" aria-live="polite" data-testid={testIds.interim}>
          {dictation.status === "starting" ? (
            <span className="ai-listening">Allow the microphone if your browser asks…</span>
          ) : dictation.interim ? (
            dictation.interim
          ) : (
            <span className="ai-listening">Listening{dictation.onDevice ? " on this device" : ""}…</span>
          )}
        </p>
      )}
      {dictation.status === "listening" && !dictation.onDevice && (
        <p className="ai-speech-service" data-testid={testIds.service}>
          {speechServiceNote()}
        </p>
      )}
      {dictation.message && (
        <p
          className={`ai-note${dictation.message.tone === "error" ? " is-error" : ""}`}
          role={dictation.message.tone === "error" ? "alert" : "status"}
          data-testid={testIds.message}
        >
          {dictation.message.text}
        </p>
      )}
    </>
  );
}
