import { useCallback, useEffect, useRef } from "react";
import { stopStream, type Recording } from "./capture";

/** Owns capture resources and invalidates every pending async continuation when a take expires. */
export function useRecordingSession(unframe: () => void) {
  const stream = useRef<MediaStream | null>(null);
  const recording = useRef<Recording | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const cancel = useCallback(() => {
    generation.current++;
    const take = recording.current;
    recording.current = null;
    if (take && take.recorder.state !== "inactive") {
      try {
        take.recorder.stop();
      } catch {
        /* Already stopped by the browser. */
      }
    }
    stopStream(stream.current);
    stream.current = null;
    unframe();
  }, [unframe]);
  const begin = useCallback(() => {
    cancel();
    return generation.current;
  }, [cancel]);
  const valid = useCallback((token: number) => mounted.current && token === generation.current, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancel();
    };
  }, [cancel]);
  return { stream, recording, begin, valid, cancel };
}
