import { base64UrlToBytes, bytesToBase64Url } from "../interop/codec";
import type { RoomKeys } from "./keys";
import { SignedRoster, type RosterEntry, type RosterOp, type RosterState } from "./roster";
import { scopeOf, type EpochChain, type EpochStart } from "./epochs";
import type { Agreement } from "./signing";
import { sign, signedBytes, verify, type Identity } from "./signing";

// A signed room's session state (meeting hosts design §2, P4), beside ./session.ts, which uses it on every frame:
//
// - This member's identity (./signing.ts) and the room's roster (./roster.ts), rooted at the link's host key.
// - Bindings: each sender's presence names its member key and its Yjs client id, with the key's signature over both
//   and the sender id (`bind`). The first key a sender binds is the one it keeps (a later claim is refused: someone
//   else can't take a sender's frames over); its client id may change, signed by the same key (Yjs may draw another).
// - Frames: every frame's message is signed by its sender's key over the room id, the header (channel, epoch,
//   sender, counter) and the message, inside the encryption; a frame is used only once that verifies under the key
//   its sender bound.
//
// What's enforced from here, against peers running an honest copy, is in docs/research/collaboration-threat-model.md
// ("Signed rooms"): roles change only by entries the roster's authority rules allow, a viewer's edits reach no one,
// and only the driver moves the shared Live run.

export interface Binding {
  key: string;
  client: number;
  bind: string;
}

/** A peer's binding, and the presence frame it came in (an older frame never replaces a newer one). */
interface PeerBinding extends Binding {
  counter: number;
}

const frameBytes = (roomId: Uint8Array, head: Uint8Array, message: Uint8Array) =>
  signedBytes("livediagrams/frame/v1", roomId, head, message);

const bindBytes = (keys: RoomKeys, sender: Uint8Array, key: string, client: number) =>
  signedBytes("livediagrams/bind/v1", keys.roomIdBytes, keys.epoch, sender, key, client);

export class SignedRoom {
  private readonly single?: SignedRoster;
  private readonly bindings = new Map<string, PeerBinding>();
  /**
   * Who each sender is (its member key), apart from its binding: a binding is signed for one epoch and goes with it,
   * but the person behind a sender doesn't change, so a re-key keeps this for the members who stay (roles resolve by
   * it while they bind again; frames are still checked against bindings only).
   */
  private readonly identities = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  /** This session's own binding, as its presence says it. */
  mine?: Binding;

  constructor(
    public keys: RoomKeys,
    readonly hostKey: string,
    readonly identity: Identity,
    /** A knock-to-join room (v3): its epochs, and this member's key-agreement key. */
    readonly knock?: { chain: EpochChain; agreement: Agreement },
  ) {
    if (!knock) this.single = new SignedRoster(hostKey, keys.roomId, keys.epoch);
    knock?.chain.subscribe(() => {
      for (const l of this.listeners) l();
    });
  }

  /**
   * Knock-to-join: the epoch this session is in (its start). Only ever moves forward (./session.ts); its roster is the
   * one every check reads, whatever else the chain holds.
   */
  current?: EpochStart;

  /** The current epoch's roster (at the door, before any epoch: the room's host alone). */
  get roster(): SignedRoster {
    return (
      this.single ??
      (this.current && this.knock!.chain.rosterOf(this.current)) ??
      (this.door ??= new SignedRoster(this.hostKey, this.keys.roomId, "door", { knock: true }))
    );
  }

  private door?: SignedRoster;

  /** The current epoch's scope (knock-to-join; "" at the door), or its number. */
  get scope(): string {
    if (this.knock) return this.current ? scopeOf(this.current) : "";
    return String(this.keys.epoch);
  }

  /** Whether `key` is in the room this epoch (always, in a room without knock-to-join). */
  isMember(key: string | undefined): boolean {
    return !this.knock || (!!key && this.state().members.has(key));
  }

  /**
   * A new epoch (knock-to-join): its keys, and nobody bound yet (bindings are signed for their epoch); everyone says
   * who they are again.
   */
  rekey(keys: RoomKeys, start: EpochStart): void {
    this.current = start;
    this.keys = keys;
    this.bindings.clear();
    const members = this.state().members;
    for (const [sender, key] of this.identities) if (!members.has(key)) this.identities.delete(sender);
    this.mine = undefined;
    for (const l of this.listeners) l();
  }

  get key(): string {
    return this.identity.key;
  }

  state(): RosterState {
    return this.roster.state();
  }

  /** Whether `key` can edit (the host, a co-host, someone admitted). */
  isEditor(key: string | undefined): boolean {
    return !!key && this.state().editors.has(key);
  }

  /** Whether this person can edit: the roster says so (a newcomer views until the host or a co-host admits them). */
  get canEdit(): boolean {
    return this.state().editors.has(this.key);
  }

  /** The key a sender bound, once its presence's binding verified. */
  keyOf(sender: string): string | undefined {
    return this.bindings.get(sender)?.key;
  }

  clientOf(sender: string): number | undefined {
    return this.bindings.get(sender)?.client;
  }

  /** Who a sender is (its member key): bound now, or bound before a re-key it stayed through. For roles, not frames. */
  identityOf(sender: string): string | undefined {
    return this.bindings.get(sender)?.key ?? this.identities.get(sender);
  }

  /** The senders known to be `key` (bound, or from before a re-key), lowest first. */
  sendersFor(key: string): string[] {
    const out = new Set(this.sendersOf(key));
    for (const [sender, k] of this.identities) if (k === key) out.add(sender);
    return [...out].sort();
  }

  /** The senders bound to `key` (a reload's old session may linger), lowest first. */
  sendersOf(key: string): string[] {
    return [...this.bindings]
      .filter(([, b]) => b.key === key)
      .map(([s]) => s)
      .sort();
  }

  /** Bindings changed (a sender bound, a client id re-bound) or the roster did. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    const stop = this.single?.subscribe(fn);
    return () => {
      this.listeners.delete(fn);
      stop?.();
    };
  }

  /** This session's binding for its sender id and Yjs client id: what its presence carries. */
  async bindMine(sender: Uint8Array, client: number): Promise<Binding> {
    const sig = await sign(this.identity.privateKey, bindBytes(this.keys, sender, this.key, client));
    this.mine = { key: this.key, client, bind: bytesToBase64Url(sig) };
    return this.mine;
  }

  /** The signature a frame carries: over the room id, its header and its message. */
  signFrame = (head: Uint8Array, message: Uint8Array): Promise<Uint8Array> =>
    sign(this.identity.privateKey, frameBytes(this.keys.roomIdBytes, head, message));

  /** Whether a frame's signature is `key`'s. */
  verifyFrame(key: string, head: Uint8Array, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    return verify(key, signature, frameBytes(this.keys.roomIdBytes, head, message));
  }

  /**
   * A presence's binding for `sender`, from its presence frame number `counter`: "same" (already held, or from an
   * older frame than the one held: it changes nothing), "bound" (new, or its client id changed: verified), or why
   * not: "rebound" (the sender bound another key first) or "bad-binding" (the signature doesn't verify).
   */
  async bindPeer(
    sender: string,
    senderBytes: Uint8Array,
    b: Binding,
    counter: number,
  ): Promise<"same" | "bound" | "rebound" | "bad-binding"> {
    const held = this.bindings.get(sender);
    if (held && held.key !== b.key) return "rebound";
    if (held && held.counter >= counter) return "same";
    if (held && held.client === b.client && held.bind === b.bind) {
      held.counter = counter;
      return "same";
    }
    let sig: Uint8Array;
    try {
      sig = base64UrlToBytes(b.bind);
    } catch {
      return "bad-binding";
    }
    if (!(await verify(b.key, sig, bindBytes(this.keys, senderBytes, b.key, b.client)))) return "bad-binding";
    // Checked again: another binding may have landed while this one verified.
    const now = this.bindings.get(sender);
    if (now && now.key !== b.key) return "rebound";
    if (now && now.counter >= counter) return "same";
    this.bindings.set(sender, { key: b.key, client: b.client, bind: b.bind, counter });
    this.identities.set(sender, b.key);
    for (const l of this.listeners) l();
    return "bound";
  }

  /** Entries from a peer or a record (./roster.ts checks each). */
  addEntries(list: readonly unknown[], budget?: () => boolean) {
    if (this.knock) return this.knock.chain.addEntries(this.scope, list, budget);
    return this.roster.add(list, budget);
  }

  /** A new entry by this member; undefined when it may not make it now, or it changes nothing. */
  append(
    op: RosterOp,
    fields: { who?: string; viewOnly?: boolean; x?: string; ask?: boolean } = {},
  ): Promise<RosterEntry | undefined> {
    return this.roster.append(this.identity, op, fields);
  }
}
