import { lazyComponent } from "../lib/lazyLoad";

/**
 * The collaboration proof (src/collab, docs/research/collaboration.md C0). Its code, Yjs included, is a chunk of its
 * own that loads only when this preset opens, so not even the Lab carries it otherwise.
 */
export const CollabLab = lazyComponent(
  () => import("../collab/lab/CollabDemo").then((m) => m.CollabDemo),
  (_props, status) =>
    status.failed ? (
      <p role="alert" data-testid="collab-load-failed">
        The collaboration code didn't load.{" "}
        <button className="btn" onClick={status.retry} data-testid="collab-load-retry">
          Retry
        </button>
      </p>
    ) : (
      <p data-testid="collab-loading">Loading…</p>
    ),
);

export const CollabEditorLab = lazyComponent(() => import("../collab/lab/EditorDemo").then((m) => m.EditorDemo));
