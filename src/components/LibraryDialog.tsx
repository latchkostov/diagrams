import { useMemo, useState } from "react";
import { Dialog } from "../interop/ui/Dialog";
import { Glyph } from "../interop/ui/glyphs";
import { Icon } from "./Icon";
import { InlineInput } from "./InlineInput";
import { DiagramThumbnail } from "./DiagramThumbnail";
import { NEARLY_FULL, storageUsage, type LibraryEntry } from "../lib/diagramIO";
import { formatAgo } from "../lib/time";

/** Storage in bytes (UTF-16: two per character), as KB below a tenth of a megabyte. */
const size = (chars: number) =>
  chars * 2 < 100_000
    ? `${Math.max(1, Math.round((chars * 2) / 1000))} KB`
    : `${((chars * 2) / 1_000_000).toFixed(1)} MB`;

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
  ...actions
}: LibraryActions & { entries: LibraryEntry[]; current: string; onClose: () => void }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  // Re-measured when the list changes (create, delete, duplicate), not on every render.
  const listKey = entries.map((e) => `${e.slug}:${e.updatedAt}`).join();
  const usage = useMemo(() => {
    void listKey;
    return storageUsage();
  }, [listKey]);
  const nearlyFull = usage.ratio >= NEARLY_FULL;

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
      {entries.length === 0 ? (
        <p className="lib-empty" data-testid="library-empty">
          No diagrams yet. Start a new one, or open a file from draw.io, Mermaid or Diagrams.
        </p>
      ) : (
        <ul className="lib-list" aria-label="Your diagrams">
          {entries.map((e) => (
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
                    {e.slug === current ? "Open now · " : ""}
                    {e.nodes} {e.nodes === 1 ? "node" : "nodes"} · edited {formatAgo(e.updatedAt)}
                  </span>
                </span>
              </button>
              {renaming === e.slug && (
                <span className="lib-rename" data-local-keys>
                  <InlineInput
                    value={e.title}
                    placeholder="Diagram title"
                    testId="library-rename-input"
                    onDone={(next) => {
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
    </Dialog>
  );
}
