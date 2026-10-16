import { structuralText } from "../model/diagramDiff";
import type { DiagramFile } from "../model/types";
import { EditorBinding } from "./binding";
import type { Clock } from "./clock";
import type { CollabDoc } from "./doc";
import type { RoomLink } from "./link";
import type { RandomBytes } from "./random";
import { CollabSession } from "./session";
import type { CollabTransport } from "./transport/types";

// One person in a room without the canvas: a session, a plain in-memory editor (an EditorPort holding a
// DiagramFile) and the binding between them. The Lab's clients and the tests use it; C1's canvas binds the real
// editor through the same EditorPort instead.

export class RoomClient {
  diagram: DiagramFile | undefined;
  binding!: EditorBinding;
  private ids = 0;

  constructor(
    readonly name: string,
    public session: CollabSession,
  ) {
    this.bind();
  }

  bind(): void {
    this.binding = new EditorBinding(
      this.session,
      {
        getDiagram: () => this.diagram,
        applyDiagram: (next) => {
          this.diagram = next;
        },
      },
      () => ({ diagram: this.diagram, private: this.diagram?.private }),
    );
  }

  get ready() {
    return this.binding.ready;
  }

  /**
   * An id no one else in the room will pick: the session's random sender id (new on every join) and a counter. Not
   * the alias (two people can share one) and not a counter alone (it starts again on rejoin).
   */
  newId(base: string) {
    return `${base}-${this.session.senderId.slice(0, 10)}-${++this.ids}`;
  }

  /** One editor step. False when nothing was sent (not ready, no change, or the room was left). */
  edit(change: (d: DiagramFile) => DiagramFile, merge?: string): boolean {
    if (!this.ready) return false;
    this.diagram = change(structuredClone(this.diagram!));
    return this.binding.localChanged({ merge });
  }

  /** The room's projection, with what it hides, as comparable text. */
  projection(): string {
    const p = this.session.doc.project();
    if (p.status !== "ok") throw new Error(`${this.name}: ${p.error}`);
    return structuralText({ diagram: p.diagram, hidden: [...p.hidden].sort() });
  }
}

export interface RoomClientOptions {
  name: string;
  transport: CollabTransport;
  room: RoomLink;
  clock: Clock;
  random?: RandomBytes;
  clientId?: number;
  initial?: DiagramFile;
  doc?: CollabDoc;
}

export async function openRoomClient(o: RoomClientOptions): Promise<RoomClient> {
  const session = await CollabSession.open({
    room: o.room,
    transport: o.transport,
    privacy: { diagram: o.initial, private: o.initial?.private },
    initial: o.initial,
    doc: o.doc,
    clock: o.clock,
    random: o.random,
    clientId: o.clientId,
    presence: { alias: o.name },
  });
  const client = new RoomClient(o.name, session);
  if (o.initial) client.diagram = session.doc.project().diagram;
  return client;
}
