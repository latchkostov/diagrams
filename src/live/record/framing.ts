// Presentation framing while recording, and the "a recording is live" flag other handlers check.
//
// Presentation mode belongs to the app's URL state (`present=1`, src/lib/urlState.ts), which
// re-reads the address on popstate, the same way src/lib/canvasBridge.ts switches views. Recording
// turns it on for the take and back off afterwards, without adding history entries.

let active = false;

/** True from the share prompt until the recording stops (L and Esc must not leave live view). */
export const isRecordingActive = () => active;
export function setRecordingActive(on: boolean): void {
  active = on;
}

/** Turns presentation on or off through the URL. Returns false when it was already that way. */
export function setPresentation(on: boolean): boolean {
  const url = new URL(window.location.href);
  const view = url.searchParams.get("view");
  if (view && view !== "canvas") return false;
  if ((url.searchParams.get("present") === "1") === on) return false;
  if (on) url.searchParams.set("present", "1");
  else url.searchParams.delete("present");
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new PopStateEvent("popstate"));
  return true;
}

/** The attribute that frames the capture target while recording (see live.css). */
export const RECORDING_ATTR = "data-lv-recording";
