import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "../interop/ui/Dialog";
import { Glyph } from "../interop/ui/glyphs";
import { Icon } from "./Icon";
import { InlineInput } from "./InlineInput";
import { DiagramThumbnail } from "./DiagramThumbnail";
import { NEARLY_FULL, storageUsage, type LibraryEntry } from "../lib/diagramIO";
import { formatAgo } from "../lib/time";

/** Show the storage meter from this share of the budget (it always shows once nearly full). */
const SHOW_USAGE_FROM = 0.5;

/** Storage in bytes (UTF-16: two per character), as KB below a tenth of a megabyte. */
const size = (chars: number) =>
  chars * 2 < 100_000
    ? `${Math.max(1, Math.round((chars * 2) / 1000))} KB`
    : `${((chars * 2) / 1_000_000).toFixed(1)} MB`;
const PAGE_SIZE = 20;

export interface LibraryActions {
  onOpen: (slug: string) => void;
  onRename: (slug: string, title: string) => void;
  onDuplicate: (slug: string) => void;
  onDelete: (slug: string) => void;
  onNew: () => void;
}

/**
 * "Your diagrams" (File → Your diagrams…): every diagram kept in this browser, most recent first,
 * with Rename, Duplicate and Delete (undoable) on each, and how much of the browser's storage they use.
 */
export function LibraryDialog({
  entries,
  current,
  onClose,
  error,
  undo,
  ...actions
}: LibraryActions & {
  entries: LibraryEntry[];
  current: string;
  onClose: () => void;
  error?: string | null;
  undo?: { message: string; run: () => void } | null;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [page, setPage] = useState(() =>
    Math.floor(
      Math.max(
        0,
        entries.findIndex((e) => e.slug === current),
      ) / PAGE_SIZE,
    ),
  );
  const lastPage = Math.max(0, Math.ceil(entries.length / PAGE_SIZE) - 1);
  if (page > lastPage) setPage(lastPage);
  const shownPage = Math.min(page, lastPage);
  const visible = entries.slice(shownPage * PAGE_SIZE, (shownPage + 1) * PAGE_SIZE);
  const content = useRef<HTMLDivElement>(null);
  const focus = useRef<HTMLElement | null>(null);
  const previous = useRef(visible);
  const renameFocus = useRef<string | null>(null);
  const focusControl = (testId: string) =>
    content.current?.querySelector<HTMLElement>(`[data-testid="${testId}"]`)?.focus({ preventScroll: true });
  useLayoutEffect(() => {
    if (renameFocus.current && !renaming) {
      focusControl(`library-rename-${renameFocus.current}`);
      renameFocus.current = null;
    } else if (focus.current && !focus.current.isConnected && document.activeElement === document.body) {
      const oldIndex = previous.current.findIndex((e) => focus.current?.dataset.testid?.endsWith(e.slug));
      const next = visible[Math.max(0, Math.min(oldIndex, visible.length - 1))];
      if (next) focusControl(`library-open-${next.slug}`);
      else document.querySelector<HTMLElement>('[data-testid="library-new"]')?.focus();
    }
    previous.current = visible;
  });
  // Re-measured when the list changes (create, delete, duplicate), not on every render.
  const listKey = entries.map((e) => `${e.slug}:${e.updatedAt}`).join();
  const usage = useMemo(() => {
    void listKey;
    return storageUsage();
  }, [listKey]);
  const nearlyFull = usage.ratio >= NEARLY_FULL;
  // The meter waits until storage is half full: below that it's noise.
  const showUsage = usage.ratio >= SHOW_USAGE_FROM;

  return (
    <Dialog
      title="Your diagrams"
      subtitle="Kept in this browser. Save or export a diagram to keep a copy elsewhere."
      icon={<Glyph name="stack" />}
      onClose={onClose}
      testId="library-dialog"
      width={600}
      footer={
        <>
          {showUsage && (
            <div
              className={`lib-usage${nearlyFull ? " is-full" : ""}`}
              data-testid="library-usage"
              data-ratio={usage.ratio.toFixed(3)}
              title="Browsers give each site about 10 MB for everything it keeps."
            >
              <span className="lib-meter" aria-hidden>
                <span style={{ width: `${Math.min(100, Math.max(2, usage.ratio * 100))}%` }} />
              </span>
              <span>
                {nearlyFull
                  ? `Storage almost full (${Math.round(usage.ratio * 100)}%). Delete or export diagrams you don't need.`
                  : `${size(usage.used)} of about ${size(usage.budget)} used`}
              </span>
            </div>
          )}
          <span className="ix-grow" />
          <button
            className="btn btn-primary"
            onClick={() => {
              onClose();
              actions.onNew();
            }}
            data-testid="library-new"
          >
            <Icon name="plus" size={14} /> New diagram
          </button>
        </>
      }
    >
      <div
        ref={content}
        onFocusCapture={(event) => {
          focus.current = event.target as HTMLElement;
        }}
      >
        {error && (
          <p role="alert" data-testid="library-error">
            {error}
          </p>
        )}
        {undo && (
          <div role="status" data-testid="library-deletion">
            {undo.message}{" "}
            <button className="btn" data-testid="library-delete-undo" onClick={undo.run}>
              Undo
            </button>
          </div>
        )}
        {entries.length === 0 ? (
          <p className="lib-empty" data-testid="library-empty">
            No diagrams yet. Start a new one, or open a file from draw.io, Mermaid or Live Diagrams.
          </p>
        ) : (
          <ul className="lib-list" aria-label="Your diagrams">
            {visible.map((e) => (
              <li
                key={e.slug}
                className={`lib-row${e.slug === current ? " is-current" : ""}${renaming === e.slug ? " is-renaming" : ""}`}
                data-testid={`library-item-${e.slug}`}
              >
                <button
                  className="lib-open"
                  onClick={() => {
                    onClose();
                    actions.onOpen(e.slug);
                  }}
                  data-testid={`library-open-${e.slug}`}
                  data-autofocus={e.slug === current ? true : undefined}
                  aria-current={e.slug === current ? "true" : undefined}
                >
                  <span className="lib-thumb">
                    <DiagramThumbnail thumb={e.thumb} />
                  </span>
                  <span className="lib-text">
                    {renaming === e.slug ? null : <strong data-testid={`library-title-${e.slug}`}>{e.title}</strong>}
                    <span>
                      {(e.private || e.localOnly) && (
                        <span className="lib-private" data-testid={`library-private-${e.slug}`}>
                          <Icon name="lock" size={11} /> Private ·{" "}
                        </span>
                      )}
                      {e.slug === current ? "Open now · " : ""}
                      {e.nodes} {e.nodes === 1 ? "node" : "nodes"} · edited {formatAgo(e.updatedAt)}
                    </span>
                  </span>
                </button>
                {renaming === e.slug && (
                  <span
                    className="lib-rename"
                    data-local-keys
                    onKeyDownCapture={(event) => {
                      // Restoring focus during Enter must not activate the Rename button
                      // with the same key's default action and reopen the editor.
                      if (event.key === "Enter" || event.key === "Escape") event.preventDefault();
                    }}
                  >
                    <InlineInput
                      value={e.title}
                      placeholder="Diagram title"
                      testId="library-rename-input"
                      onDone={(next) => {
                        // Keyboard completion still owns the input. Blur has already
                        // handed focus to the pointer/Tab destination; don't steal it.
                        if ((document.activeElement as HTMLElement | null)?.dataset.testid === "library-rename-input")
                          renameFocus.current = e.slug;
                        setRenaming(null);
                        if (next !== null && next.trim() && next.trim() !== e.title)
                          actions.onRename(e.slug, next.trim());
                      }}
                    />
                  </span>
                )}
                <span className="lib-actions">
                  <button
                    className="icon-btn icon-btn-quiet"
                    onClick={() => setRenaming(e.slug)}
                    aria-label={`Rename ${e.title}`}
                    title="Rename"
                    data-testid={`library-rename-${e.slug}`}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  <button
                    className="icon-btn icon-btn-quiet"
                    onClick={() => actions.onDuplicate(e.slug)}
                    aria-label={`Duplicate ${e.title}`}
                    title="Duplicate"
                    data-testid={`library-duplicate-${e.slug}`}
                  >
                    <Icon name="duplicate" size={14} />
                  </button>
                  <button
                    className="icon-btn icon-btn-quiet lib-delete"
                    onClick={() => actions.onDelete(e.slug)}
                    aria-label={`Delete ${e.title}`}
                    title="Delete (undoable)"
                    data-testid={`library-delete-${e.slug}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        {entries.length > PAGE_SIZE && (
          <div aria-label="Library pages">
            <button
              className="btn"
              data-testid="library-page-prev"
              disabled={shownPage === 0}
              onClick={() => {
                setRenaming(null);
                setPage(shownPage - 1);
              }}
            >
              Previous
            </button>
            <span role="status" data-testid="library-page-status">
              {shownPage * PAGE_SIZE + 1}–{Math.min((shownPage + 1) * PAGE_SIZE, entries.length)} of {entries.length}
            </span>
            <button
              className="btn"
              data-testid="library-page-next"
              disabled={shownPage === lastPage}
              onClick={() => {
                setRenaming(null);
                setPage(shownPage + 1);
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </Dialog>
  );
}
