import { useEffect, useState, useSyncExternalStore } from "react";
import type { DiagramFile } from "../../model/types";
import { createMessageTypesReader } from "./messageTypesReader";

export function useMessageTypes(diagram: DiagramFile, paused = false) {
  const [reader] = useState(() => createMessageTypesReader());
  useEffect(() => {
    reader.update(diagram, paused);
    return reader.cancel;
  }, [reader, diagram, paused]);
  const types = useSyncExternalStore(reader.subscribe, reader.get, reader.get);
  return { types, updating: !reader.current(diagram) };
}
