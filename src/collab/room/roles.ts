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

export interface Roster {
  /** The host's sender id (this person's included), if anyone claims it. */
  host?: string;
  cohosts: string[];
  /** Who drives Live: the roster's driver while they're here, else the host. */
  driver?: string;
}

export interface Claim {
  sender: string;
  host?: true;
  cohosts?: string[];
  driver?: string;
}

/** The roster as the room's presence says it: this person's claim with everyone else's. */
export function rosterOf(me: Claim, peers: readonly Claim[]): Roster {
  const all = [me, ...peers];
  const host = all
    .filter((p) => p.host)
    .map((p) => p.sender)
    .sort()[0];
  const claim = all.find((p) => p.sender === host);
  const here = new Set(all.map((p) => p.sender));
  const cohosts = (claim?.cohosts ?? []).filter((s) => here.has(s) && s !== host);
  const driver = claim?.driver && here.has(claim.driver) ? claim.driver : host;
  return { host, cohosts, driver };
}

/**
 * Who becomes host when the host leaves on purpose: the earliest co-host still here, else whoever has been here
 * longest (`since`: when this host first saw each of them; ties go to the lowest sender id).
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
