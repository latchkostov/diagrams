import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type Ref,
  type RefObject,
  type SetStateAction,
} from "react";
import type { EditorApi } from "../../editor/types";
import type { EditorRoom } from "../../editor/room";
import { retainConversation } from "../../lib/exampleConversations";
import {
  copyEditedExample,
  emptyDiagram,
  getAutosave,
  getDiagramIdentity,
  getOriginal,
  releaseExampleSaveTarget,
  writeAutosave,
} from "../../lib/diagramIO";
import type { DiagramFile } from "../../model/types";
import { notify } from "../../interop/ui/toast";
import { t as tr } from "../../i18n";
import { fromFlow, toFlow, type DiagramMeta } from "../convert";
import type { DiagramFlowEdge, FlowNode } from "../types";

export interface CanvasHandle {
  getDocumentVersion: EditorApi["getDocumentVersion"];
  /** Current canvas as a diagrams/v1 file. */
  getDiagram: () => DiagramFile;
  /** Writes pending edits to storage now (before reading or replacing this diagram's stored copy). */
  flush: () => void;
  /** Renames the diagram as a normal, undoable edit. */
  setTitle: (title: string) => void;
}

type DocumentState = { meta: DiagramMeta; nodes: FlowNode[]; edges: DiagramFlowEdge[] };
type LatestDocument = DocumentState & { slug: string; revision: string };
type FlushSave = (override?: DiagramFile) => boolean | undefined;
type SetModified = Dispatch<SetStateAction<boolean>>;

declare global {
  interface Window {
    __documentProbe?: () => { saved: boolean };
  }
}

const normalize = (d: DiagramFile) => {
  const f = toFlow(d);
  return JSON.stringify(fromFlow(f.meta, f.nodes, f.edges));
};

/** Load once for this canvas's lifetime, before its editor state is initialized. */
export function useDocumentLoad(initial: DiagramFile | undefined, slug: string) {
  const [loaded] = useState(() => {
    const original = initial ?? getOriginal(slug) ?? emptyDiagram();
    const flow = toFlow((initial ? undefined : getAutosave(slug)) ?? original);
    return {
      original,
      flow,
      originalJson: normalize(original),
      loadedJson: JSON.stringify(fromFlow(flow.meta, flow.nodes, flow.edges)),
      // The document this canvas loaded: late writes (an unmount flush) never land on a replacement.
      identity: initial ? undefined : getDiagramIdentity(slug),
    };
  });
  return loaded;
}

/** Save refs stay at their original position, before the camera and editor hooks. */
export function useDocumentSave({
  meta,
  nodes,
  edges,
  slug,
  saveRevision,
  loadedJson,
  originalJson,
  onExampleCopy,
  readOnly,
  room,
  identity,
  renameHistoryTitle,
  original,
  setMeta,
}: DocumentState & {
  slug: string;
  saveRevision: string;
  loadedJson: string;
  originalJson: string;
  onExampleCopy?: (source: string, copy: string, title: string) => void;
  readOnly: boolean;
  room?: EditorRoom;
  identity?: string;
  renameHistoryTitle: (from: string, to: string) => void;
  original: DiagramFile;
  setMeta: Dispatch<SetStateAction<DiagramMeta>>;
}) {
  const latest = useRef({ meta, nodes, edges, slug, revision: saveRevision });
  useLayoutEffect(() => {
    latest.current = { meta, nodes, edges, slug, revision: saveRevision };
  });
  const lastSaved = useRef(loadedJson);
  const saveBaseline = useRef(originalJson);
  const copyCallback = useRef(onExampleCopy);
  useLayoutEffect(() => {
    copyCallback.current = onExampleCopy;
  });
  const copiedExample = useRef<{ slug: string; identity: string } | null>(null);
  const exampleCopyFailed = useRef(false);
  useLayoutEffect(() => {
    if (!(import.meta.env.DEV || import.meta.env.VITE_E2E === "1")) return;
    const probe = () => {
      const { meta, nodes, edges } = latest.current;
      return { saved: JSON.stringify(fromFlow(meta, nodes, edges)) === lastSaved.current };
    };
    window.__documentProbe = probe;
    return () => {
      if (window.__documentProbe === probe) delete window.__documentProbe;
    };
  }, []);
  /** Returns whether the diagram differs from its original, or undefined when there was nothing to write. */
  const flushSave = useCallback(
    (override?: DiagramFile): boolean | undefined => {
      if (readOnly || room) return undefined;
      // Measurements, selection and viewport changes are not document edits. In particular,
      // opening a previously edited example must not promote it before a new edit occurs.
      if (!override && latest.current.revision === lastSaved.current) return undefined;
      const { meta, nodes, edges, slug } = latest.current;
      let d = override ?? fromFlow(meta, nodes, edges);
      let json = JSON.stringify(d);
      if (json === lastSaved.current) return undefined;
      const mod = json !== saveBaseline.current;
      // Only the editable app promotes examples; embeds and exported viewers never save.
      if (mod && identity && copyCallback.current && !copiedExample.current) {
        try {
          const copy = copyEditedExample(slug, d, identity);
          if (copy) {
            const sourceTitle = d.title;
            const canvasTitle = sourceTitle.trim() ? copy.title : sourceTitle;
            renameHistoryTitle(sourceTitle, canvasTitle);
            copiedExample.current = { slug: copy.slug, identity: getDiagramIdentity(copy.slug) };
            saveBaseline.current = JSON.stringify({ ...d, title: copy.title });
            d = { ...d, title: canvasTitle };
            json = JSON.stringify(d);
            latest.current = { ...latest.current, slug: copy.slug, meta: toFlow(d).meta };
            setMeta((current) => ({ ...current, title: canvasTitle }));
            copyCallback.current(slug, copy.slug, original.title);
          }
        } catch {
          if (!exampleCopyFailed.current) notify(tr("library.storageFull"), { kind: "error" });
          exampleCopyFailed.current = true;
          return mod;
        }
      }
      const destination = copiedExample.current?.slug ?? slug;
      if (writeAutosave(destination, mod ? d : null, copiedExample.current?.identity ?? identity))
        lastSaved.current = json;
      return mod;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setMeta is CanvasView's stable state setter; preserve the original dependencies
    [readOnly, room, identity, renameHistoryTitle, original.title],
  );
  return { latest, exampleCopyFailed, flushSave };
}

/** Install after the editor/host hooks; release conversation retention after the unmount flush. */
export function useAutosave({
  saveRevision,
  readOnly,
  flushSave,
  firstExampleEdit,
  exampleCopyFailed,
  latest,
  conversationIdentity,
  setModified,
}: {
  saveRevision: string;
  readOnly: boolean;
  flushSave: FlushSave;
  firstExampleEdit: boolean;
  exampleCopyFailed: RefObject<boolean>;
  latest: RefObject<LatestDocument>;
  conversationIdentity?: string;
  setModified: SetModified;
}) {
  // ---------------------------------------------------------------- autosave
  // Debounced while editing, and flushed whenever the canvas could go away before the timer fires:
  // on unmount (switching diagrams), on page hide (reload, close, navigation) and when the tab is
  // hidden (mobile browsers may discard it). Writes the latest state, never a stale closure, and
  // drops the save again once the diagram matches the original.
  useEffect(() => {
    if (readOnly) return;
    const t = setTimeout(
      () => {
        const mod = flushSave();
        if (mod !== undefined) setModified(mod);
      },
      firstExampleEdit && !exampleCopyFailed.current ? 0 : 300,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the ref and state setter are stable for this canvas; preserve the original dependencies
  }, [saveRevision, readOnly, flushSave, firstExampleEdit]);
  useEffect(() => {
    if (readOnly) return;
    const onPageHide = () => void flushSave();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushSave();
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flushSave();
      // eslint-disable-next-line react-hooks/exhaustive-deps -- read the latest save destination at unmount, including any example promotion
      releaseExampleSaveTarget(latest.current.slug);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- latest is the same lifetime ref; preserve the original dependencies
  }, [readOnly, flushSave]);

  // Release after the unmount flush: promotion still needs this tab's conversation snapshot.
  useEffect(
    () => (conversationIdentity ? retainConversation(conversationIdentity) : undefined),
    [conversationIdentity],
  );
}

export function useDocumentHandle({
  ref,
  meta,
  nodes,
  edges,
  flushSave,
  editor,
  room,
  privacy,
  setModified,
  onTitleChange,
}: DocumentState & {
  ref?: Ref<CanvasHandle>;
  flushSave: FlushSave;
  editor: EditorApi;
  room?: EditorRoom;
  privacy: "private" | "local-only" | null;
  setModified: SetModified;
  onTitleChange?: (title: string) => void;
}) {
  useImperativeHandle(
    ref,
    () => ({
      getDiagram: () => ({ ...fromFlow(meta, nodes, edges), ...(room && privacy !== null ? { private: true } : {}) }),
      flush: () => {
        const mod = flushSave();
        if (mod !== undefined) setModified(mod);
      },
      setTitle: (title: string) => editor.updateMeta({ title }),
      getDocumentVersion: editor.getDocumentVersion,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setModified is CanvasView's stable state setter; preserve the original dependencies
    [meta, nodes, edges, flushSave, editor, room, privacy],
  );

  useEffect(() => onTitleChange?.(meta.title), [meta.title, onTitleChange]);
}
