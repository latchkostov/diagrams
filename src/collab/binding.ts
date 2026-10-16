import { canCollaborate, type CanvasPrivacyState } from "../lib/localOnly";
import type { DiagramFile } from "../model/types";
import { commandsFromDiff } from "./commands";
import type { CollabSession } from "./session";

// Joins an editor to a room session. The editor needs only two things (EditorApi has both): read its diagram, and
// replace it with a validated one. Every editor mutation path (menus, shortcuts, the inspector, drags, paste, AI
// turns) ends in the editor's state; the editor calls `localChanged` after each committed step, and that one
// call turns the step into commands (./commands.ts) against the base both sides last agreed on.
//
// C1 wires `localChanged` to the editor's history commit (useHistory, where every step is recorded) and routes
// Undo/Redo to the session while a room is open, in place of the snapshot history. C0 proves the contract with the
// Lab's clients and unit tests.
//
// Privacy: the editor's `private` flag is the device's own. It is never sent, and a remote change can't set or
// clear it. If the diagram becomes Private (or local-only) during a session, the next step leaves the room
// instead of sending anything.

export interface EditorPort {
  /** The editor's diagram; undefined while a joiner waits for the room's. */
  getDiagram(): DiagramFile | undefined;
  /** Replaces the editor's diagram with a remote result (already validated). Not a local step. */
  applyDiagram(next: DiagramFile): void;
}

export class EditorBinding {
  private base: DiagramFile | undefined;
  private stop: () => void;
  private closed = false;
  /** Why the last local step was refused, if it was. */
  refused: string | undefined;

  constructor(
    private readonly session: CollabSession,
    private readonly editor: EditorPort,
    private readonly privacy: () => CanvasPrivacyState | null | undefined,
  ) {
    this.stop = session.doc.onChange(() => this.pull());
    if (session.hasDocument) this.pull();
  }

  /** Whether the editor may edit: a joiner has nothing to edit until a peer has sent the room's diagram. */
  get ready(): boolean {
    return !this.closed && this.base !== undefined;
  }

  /**
   * The editor committed a step. Sends what changed since the agreed base, as one room step (`merge` joins it to
   * the previous one, as the editor's history does). Returns false when nothing was sent.
   */
  localChanged(opts: { merge?: string } = {}): boolean {
    if (this.closed || !this.base) return false;
    const now = this.editor.getDiagram();
    if (!now) return false;
    if (!canCollaborate(this.privacy()) || now.private) {
      void this.close();
      return false;
    }
    const commands = commandsFromDiff(this.base, now);
    if (!commands.length) {
      this.base = now;
      return false;
    }
    const result = this.session.doc.apply(commands, opts);
    if (!result.ok) {
      // A step the room would refuse (a value past the bounds): undo it in the editor and say so.
      this.refused = result.problem;
      this.pull(true);
      return false;
    }
    this.base = now;
    return true;
  }

  undo(): boolean {
    return !this.closed && this.session.doc.undo();
  }

  redo(): boolean {
    return !this.closed && this.session.doc.redo();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.stop();
    await this.session.leave();
  }

  /** Shared state changed (anyone's step, or Undo): show the projection, keeping this device's privacy flag. */
  private pull(force = false): void {
    if (this.closed) return;
    const p = this.session.doc.project();
    if (p.status !== "ok") return; // the last valid diagram stays on screen; the session reports the problem
    const local = this.editor.getDiagram();
    const next: DiagramFile = local?.private ? { ...p.diagram, private: true } : p.diagram;
    this.base = next;
    // Field by field, unchanged records by reference: a local step's own echo costs no serialisation.
    if (force || !local || commandsFromDiff(local, next).length) this.editor.applyDiagram(next);
  }
}
