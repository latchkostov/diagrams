import type { PeerPresence } from "../presence";

// The room's roles (meeting hosts design §1, P3), cooperative: each person's presence says what they claim, and the
// host's presence carries the roster (its co-hosts, and who drives Live). Nobody can prove a role yet (that's P4's
// signed grants): an honest copy follows these rules, a modified one could claim anything.
//
// - The host: whoever started the room, or whom the last host handed it to. Two claims (a handover in flight): the
//   lowest sender id.
// - Co-hosts: named by the host, earliest first. They answer requests to drive or show Live too, and the first of
//   them becomes host when the host leaves on purpose.
// - The driver: whom the host lets drive Live; the host by default. Exactly one drives at a time.
//
// The roster names people by member id (the same across each tab's reloads, ./roomRoster.ts); what's here resolves
// them to the sender ids of the people present. While no host is here, the last roster a host said stands.

/** A roster as a host says it: member ids. */
export interface RosterSource {
  host?: string;
  cohosts: string[];
  driver?: string;
}

export interface Roster {
  /** The host's sender id (this person's included), if the host is here. */
  host?: string;
  /** Co-hosts here (sender ids), earliest first. */
  cohosts: string[];
  /** Who drives Live (a sender id): the roster's driver while they're here, else the host. */
  driver?: string;
  /** The roster this comes from (members): the present host's, or the last one a host said. */
  source: RosterSource;
}

export interface Claim {
  sender: string;
  member?: string;
  host?: true;
  cohosts?: string[];
  driver?: string;
}

/** The roster as the room's presence says it: this person's claim with everyone else's; `last` while no host's here. */
export function rosterOf(me: Claim, peers: readonly Claim[], last: RosterSource = { cohosts: [] }): Roster {
  const all = [me, ...peers];
  const claim = all.filter((p) => p.host).sort((a, b) => (a.sender < b.sender ? -1 : 1))[0];
  const source: RosterSource = claim
    ? { host: claim.member, cohosts: claim.cohosts ?? [], driver: claim.driver }
    : last;
  const senderOf = (member?: string) => (member ? all.find((p) => p.member === member)?.sender : undefined);
  const host = claim?.sender;
  const cohosts = source.cohosts.map(senderOf).filter((s): s is string => !!s && s !== host);
  return { host, cohosts, driver: senderOf(source.driver) ?? host, source };
}

/**
 * Who becomes host when the host leaves on purpose: the earliest co-host still here, else whoever has been here
 * longest (`since`, by sender: when this host first saw each of them; ties go to the lowest sender id).
 */
export function successor(
  roster: Roster,
  peers: readonly string[],
  since: ReadonlyMap<string, number>,
): string | undefined {
  const here = new Set(peers);
  const cohost = roster.cohosts.find((s) => here.has(s));
  if (cohost) return cohost;
  return [...here]
    .filter((s) => s !== roster.host)
    .sort((a, b) => (since.get(a) ?? Infinity) - (since.get(b) ?? Infinity) || (a < b ? -1 : 1))[0];
}

/** A person's roles, as the people list says them. */
export function rolesOf(roster: Roster, sender: string): { host: boolean; cohost: boolean; driving: boolean } {
  return {
    host: roster.host === sender,
    cohost: roster.cohosts.includes(sender),
    driving: roster.driver === sender,
  };
}

/** The peer whose run to follow: the roster's driver if they show one, else anyone who shows one (lowest id). */
export function driverOf(roster: Roster, peers: readonly PeerPresence[]): PeerPresence | undefined {
  const showing = peers.filter((p) => p.live).sort((a, b) => (a.sender < b.sender ? -1 : 1));
  return showing.find((p) => p.sender === roster.driver) ?? showing[0];
}
