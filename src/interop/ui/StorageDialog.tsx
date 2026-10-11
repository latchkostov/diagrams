import { useCallback, useEffect, useState } from "react";
import { formatAgo } from "../../lib/time";
import type { StorageEntry } from "../storage/types";
import { Dialog } from "./Dialog";
import { Glyph, type GlyphName } from "./glyphs";

/** "Open from ▸ OneDrive / Dropbox": the diagrams in the app's own folder, newest first. */
export function StorageFilesDialog({
  label,
  icon,
  folder,
  load,
  onPick,
  onSignOut,
  onClose,
}: {
  label: string;
  icon: GlyphName;
  folder?: string;
  load: () => Promise<StorageEntry[]>;
  onPick: (entry: StorageEntry) => void;
  onSignOut?: () => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; files: StorageEntry[] }
  >({ kind: "loading" });

  const fetchFiles = useCallback(() => {
    let live = true;
    load().then(
      (files) => live && setState({ kind: "ready", files }),
      (err: unknown) => live && setState({ kind: "error", message: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      live = false;
    };
  }, [load]);
  useEffect(() => fetchFiles(), [fetchFiles]);

  return (
    <Dialog
      title={`Open from ${label}`}
      subtitle={folder ? `Diagrams saved in ${folder}` : undefined}
      icon={<Glyph name={icon} />}
      onClose={onClose}
      testId="storage-files-dialog"
      width={480}
      footer={
        <>
          <a className="link-btn" href="privacy.html" target="_blank" rel="noopener" data-testid="storage-privacy">
            Privacy
          </a>
          <span className="ix-grow" />
          {onSignOut && (
            <button className="link-btn" onClick={onSignOut} data-testid="storage-sign-out">
              Sign out of {label}
            </button>
          )}
        </>
      }
    >
      {state.kind === "loading" && (
        <p className="ix-storage-state" role="status" data-testid="storage-files-loading">
          <Glyph name="spinner" size={14} /> Loading your diagrams…
        </p>
      )}
      {state.kind === "error" && (
        <div className="ix-storage-state" role="alert" data-testid="storage-files-error">
          <p>{state.message}</p>
          <button
            className="btn"
            onClick={() => {
              setState({ kind: "loading" });
              fetchFiles();
            }}
            data-testid="storage-files-retry"
            data-autofocus
          >
            Try again
          </button>
        </div>
      )}
      {state.kind === "ready" && state.files.length === 0 && (
        <p className="ix-storage-state" data-testid="storage-files-empty">
          No diagrams here yet. Save one with File → Save to ▸ {label}.
        </p>
      )}
      {state.kind === "ready" && state.files.length > 0 && (
        <div className="ix-page-list" data-testid="storage-files">
          {state.files.map((f, i) => (
            <button
              key={`${i}:${f.name}`}
              className="ix-page"
              onClick={() => onPick(f)}
              data-testid={`storage-file-${i}`}
              data-autofocus={i === 0 ? true : undefined}
            >
              <Glyph name="file" size={14} />
              <span className="ix-page-name">{f.name}</span>
              {f.modified && !Number.isNaN(Date.parse(f.modified)) && (
                <span className="ix-storage-when">{formatAgo(Date.parse(f.modified))}</span>
              )}
              <Glyph name="chevron-right" size={14} />
            </button>
          ))}
        </div>
      )}
    </Dialog>
  );
}
