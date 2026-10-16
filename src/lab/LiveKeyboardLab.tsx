import { useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { LiveLabStage } from "../live/LiveLabStage";
import { exportFixture } from "./exportFixture";

/** A host commit during capture, before the live session receives the same key. */
export function LiveKeyboardLab() {
  const [revision, setRevision] = useState(0);
  const armed = useRef(false);
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !armed.current) return;
      armed.current = false;
      // Fits/session publication can flush a host render in an earlier handler.
      // A listener replaced by that commit will miss the event already in flight.
      flushSync(() => setRevision((value) => value + 1));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  return (
    <div data-testid="live-keyboard-host" data-revision={revision}>
      <button
        style={{ position: "relative", zIndex: 10 }}
        data-testid="live-keyboard-arm"
        onClick={() => (armed.current = true)}
      >
        Rerender on the next Escape
      </button>
      <LiveLabStage diagram={exportFixture} initial={{ live: true, traffic: false }} alwaysOn={false} />
    </div>
  );
}
