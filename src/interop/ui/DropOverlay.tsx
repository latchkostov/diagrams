import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Glyph } from "./glyphs";

const hasFiles = (e: DragEvent) => !!e.dataTransfer && [...e.dataTransfer.types].includes("Files");

/**
 * Drop files anywhere on the app to open them (several at once: a compose file with its overrides). Only reacts to OS file drags (not the palette's
 * stencil drags), and shows a full-window target while a file is over the page.
 */
export function DropOverlay({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);
  const onFilesRef = useRef(onFiles);
  useLayoutEffect(() => {
    onFilesRef.current = onFiles;
  });

  useEffect(() => {
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setActive(true);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setActive(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setActive(false);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) onFilesRef.current(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, []);

  if (!active) return null;
  return createPortal(
    <div className="ix-drop" data-testid="drop-overlay" data-editor-overlay>
      <div className="ix-drop-card">
        <span className="ix-drop-icon">
          <Glyph name="upload" size={26} />
        </span>
        <strong>Drop to open</strong>
        <span className="ix-drop-formats">
          <span>
            <Glyph name="json" size={14} /> .diagram.json
          </span>
          <span>
            <Glyph name="drawio" size={14} /> .drawio · .xml
          </span>
          <span>
            <Glyph name="mermaid" size={14} /> .mmd
          </span>
          <span>
            <Glyph name="file" size={14} /> docker-compose.yml
          </span>
        </span>
        <span className="ix-drop-hint">Opens as your diagram. Examples are never overwritten.</span>
      </div>
    </div>,
    document.body,
  );
}
