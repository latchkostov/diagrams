import { useEffect, useRef, useState } from "react";
import {
  isFatalSpeechError,
  mergeResults,
  speechErrorKind,
  speechErrorMessage,
  type SpeechText,
  type SpokenResult,
} from "./dictation";

// Dictation through the browser's Web Speech API. On-device recognition is used when the browser has
// it (Chrome's `processLocally` + `SpeechRecognition.available()`); otherwise the browser's own speech
// service transcribes, and we say so once. No keys, no servers of ours.

interface RecognitionResultList {
  readonly length: number;
  [index: number]: { readonly isFinal: boolean; readonly length: number; [i: number]: { transcript: string } };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onstart: ((e: Event) => void) | null;
  onend: ((e: Event) => void) | null;
  onresult: ((e: { resultIndex: number; results: RecognitionResultList }) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onsoundstart: ((e: Event) => void) | null;
  onsoundend: ((e: Event) => void) | null;
}
type Availability = "available" | "downloadable" | "downloading" | "unavailable";
interface RecognitionCtor {
  new (): Recognition;
  available?: (o: { langs: string[]; processLocally?: boolean }) => Promise<Availability>;
  install?: (o: { langs: string[]; processLocally?: boolean }) => Promise<boolean>;
}

/** The browser's SpeechRecognition constructor, or undefined (Firefox): then the mic isn't shown. */
export function speechRecognition(): RecognitionCtor | undefined {
  const w = globalThis as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export type DictationStatus = "idle" | "starting" | "listening";

/** Shown once per browser when audio leaves the device. */
const CLOUD_NOTE_KEY = "diagrams.ai.dictationNote.v1";
export const CLOUD_NOTE = "Your browser's speech service transcribes this (in Chrome, Google).";
/** A private diagram's dictation never goes to the browser's speech service. */
export const PRIVATE_SPEECH_NOTE =
  "Dictation is off here: this browser would send your voice to its speech service, and this diagram is private.";

type Message = { tone: "info" | "error"; text: string } | null;

interface Ui {
  status(s: DictationStatus): void;
  interim(text: string): void;
  hearing(on: boolean): void;
  message(m: Message | ((m: Message) => Message)): void;
  onDevice(on: boolean): void;
  read(): SpeechText;
  write(t: SpeechText): void;
}

function firstCloudUse(): boolean {
  try {
    if (localStorage.getItem(CLOUD_NOTE_KEY) === "1") return false;
    localStorage.setItem(CLOUD_NOTE_KEY, "1");
    return true;
  } catch {
    return true;
  }
}

const clearError = (m: Message): Message => (m?.tone === "error" ? null : m);

/**
 * The recognition lifecycle, outside React: start, keep listening across silences, stop. With
 * `onDeviceOnly()` true (a private diagram), it listens only when recognition runs on this device.
 */
function createSession(Ctor: RecognitionCtor, ui: Ui, onDeviceOnly: () => boolean = () => false) {
  let rec: Recognition | null = null;
  /** The person wants to be listening (we restart on the browser's silence timeout). */
  let wanted = false;
  let generation = 0;
  let local = false;
  let committed = 0;
  let restarts: number[] = [];

  const idle = () => {
    wanted = false;
    rec = null;
    ui.status("idle");
    ui.interim("");
    ui.hearing(false);
  };

  const open = () => {
    const r = new Ctor();
    rec = r;
    // Each session numbers its results from 0. Reset here, not on its start event: results can come first.
    committed = 0;
    r.lang = navigator.language || "en-US";
    r.continuous = true;
    r.interimResults = true;
    if (local) r.processLocally = true;
    r.onstart = () => {
      if (rec !== r) return;
      ui.status("listening");
    };
    r.onsoundstart = () => rec === r && ui.hearing(true);
    r.onsoundend = () => rec === r && ui.hearing(false);
    r.onresult = (e) => {
      if (rec !== r) return;
      const list: SpokenResult[] = [];
      for (let i = 0; i < e.results.length; i++)
        list.push({ isFinal: e.results[i].isFinal, transcript: e.results[i][0]?.transcript ?? "" });
      const before = ui.read();
      const next = mergeResults({ ...before, committed }, list);
      committed = next.committed;
      if (next.value !== before.value) ui.write({ value: next.value, caret: next.caret });
      ui.interim(next.interim);
      ui.message(clearError);
    };
    r.onerror = (e) => {
      if (rec !== r) return;
      const kind = speechErrorKind(e.error);
      // An on-device pack can go missing: fall back to the browser's service (restarts on end).
      if (kind === "language" && local && onDeviceOnly()) {
        wanted = false;
        ui.message({ tone: "info", text: PRIVATE_SPEECH_NOTE });
        return;
      }
      if (kind === "language" && local) {
        local = false;
        ui.onDevice(false);
        if (firstCloudUse()) ui.message({ tone: "info", text: CLOUD_NOTE });
        return;
      }
      const text = speechErrorMessage(kind);
      if (text) ui.message({ tone: kind === "no-speech" ? "info" : "error", text });
      if (isFatalSpeechError(kind)) wanted = false;
    };
    r.onend = () => {
      if (rec !== r) return;
      ui.interim("");
      ui.hearing(false);
      if (!wanted) return idle();
      // The browser stops after a silence: carry on, unless it keeps ending straight away.
      const now = Date.now();
      restarts = [...restarts.filter((t) => now - t < 4000), now];
      if (restarts.length > 4) {
        idle();
        ui.message({ tone: "error", text: "Dictation keeps stopping. Try again in a moment." });
        return;
      }
      open();
    };
    try {
      r.start();
    } catch {
      // Already started: nothing to do.
    }
  };

  return {
    start() {
      if (wanted) return;
      const token = ++generation;
      const previous = rec;
      rec = null;
      previous?.abort();
      wanted = true;
      restarts = [];
      ui.status("starting");
      ui.message(null);
      const lang = navigator.language || "en-US";
      const check = Ctor.available
        ? Ctor.available({ langs: [lang], processLocally: true }).then(
            (a) => {
              if (token !== generation || !wanted) return false;
              if (a === "available") return true;
              // Fetch the on-device pack for next time; this time the browser's service listens.
              if ((a === "downloadable" || a === "downloading") && Ctor.install)
                void Ctor.install({ langs: [lang], processLocally: true }).catch(() => false);
              return false;
            },
            () => false,
          )
        : Promise.resolve(false);
      void check.then((isLocal) => {
        if (!wanted || token !== generation) return;
        if (!isLocal && onDeviceOnly()) {
          idle();
          ui.message({ tone: "info", text: PRIVATE_SPEECH_NOTE });
          return;
        }
        local = isLocal;
        ui.onDevice(isLocal);
        if (!isLocal && firstCloudUse()) ui.message({ tone: "info", text: CLOUD_NOTE });
        open();
      });
    },
    stop() {
      generation++;
      wanted = false;
      // Show it stopped now; the browser's end event follows (and may still flush final words).
      ui.status("idle");
      ui.interim("");
      ui.hearing(false);
      if (!rec) return idle();
      try {
        rec.stop();
      } catch {
        idle();
      }
    },
    /** Stops at once, words in flight dropped (and a pending start cancelled); ready to start again. */
    cancel() {
      generation++;
      const r = rec;
      idle();
      try {
        r?.abort();
      } catch {
        // Already ended.
      }
    },
    dispose() {
      generation++;
      wanted = false;
      const r = rec;
      rec = null;
      try {
        r?.abort();
      } catch {
        // Already ended.
      }
    },
    get wanted() {
      return wanted;
    },
  };
}

export interface Dictation {
  supported: boolean;
  status: DictationStatus;
  /** Words heard but not settled. */
  interim: string;
  /** Hearing sound right now (drives the level pulse). */
  hearing: boolean;
  /** An inline message: a problem, or the one-time note about where audio goes. */
  message: Message;
  /** Recognition runs on this device. */
  onDevice: boolean;
  start(): void;
  stop(): void;
  /** Stops at once and drops words in flight: the request box went out of sight. */
  cancel(): void;
  toggle(): void;
}

/**
 * `read` returns the current text and caret; `write` puts spoken words back (and should move the
 * caret). Both are read through a ref, so callers can pass inline functions.
 */
export function useDictation(
  read: () => SpeechText,
  write: (t: SpeechText) => void,
  /** Listen only when speech is recognised on this device (a private diagram). */
  onDeviceOnly = false,
): Dictation {
  const [status, setStatus] = useState<DictationStatus>("idle");
  const [interim, setInterim] = useState("");
  const [hearing, setHearing] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [onDevice, setOnDevice] = useState(false);
  const io = useRef({ read, write, onDeviceOnly });
  useEffect(() => {
    io.current = { read, write, onDeviceOnly };
  });

  const [Ctor] = useState(speechRecognition);
  const session = useRef<ReturnType<typeof createSession> | null>(null);
  /** Created on first use (an event handler), never during render. */
  const ensure = () => {
    if (!session.current && Ctor)
      session.current = createSession(
        Ctor,
        {
          status: setStatus,
          interim: setInterim,
          hearing: setHearing,
          message: setMessage,
          onDevice: setOnDevice,
          read: () => io.current.read(),
          write: (t) => io.current.write(t),
        },
        () => io.current.onDeviceOnly,
      );
    return session.current;
  };
  // Leaving the dialog ends dictation for good.
  useEffect(() => () => session.current?.dispose(), []);

  return {
    supported: !!Ctor,
    status,
    interim,
    hearing,
    message,
    onDevice,
    start: () => ensure()?.start(),
    stop: () => session.current?.stop(),
    cancel: () => session.current?.cancel(),
    toggle: () => {
      const s = ensure();
      if (s?.wanted) s.stop();
      else s?.start();
    },
  };
}
