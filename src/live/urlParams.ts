// Live-view query params: `?view=canvas&example=<slug>&live=1&sim=<id>&speed=2&present=1`.
// The app's URL state (src/lib/urlState.ts) owns view / example / present; these extra params are
// read once when the canvas mounts and mirrored with replaceState so a live link can be copied.

export interface LiveParams {
  live: boolean;
  /** Saved simulation id, or null for free play. */
  sim: string | null;
  /** Initial playback speed (0.25 – 8). */
  speed: number | null;
  /** `paused=1` opens live mode without starting playback. */
  paused: boolean;
  /** `traffic=0` starts free play without continuous source traffic (tests). */
  traffic?: boolean;
}

export function parseLiveParams(search: string): LiveParams {
  const p = new URLSearchParams(search);
  const speed = Number(p.get("speed"));
  return {
    live: p.get("live") === "1" || p.has("sim"),
    sim: p.get("sim") || null,
    speed: Number.isFinite(speed) && speed >= 0.25 && speed <= 8 ? speed : null,
    paused: p.get("paused") === "1",
    ...(p.has("traffic") ? { traffic: p.get("traffic") !== "0" } : {}),
  };
}

export const readLiveParams = (): LiveParams => parseLiveParams(window.location.search);

/** Mirrors live state into the address bar without adding history entries. */
export function writeLiveParams(live: boolean, sim: string | null): void {
  const p = new URLSearchParams(window.location.search);
  if (p.get("view") !== "canvas") return;
  if (live) p.set("live", "1");
  else p.delete("live");
  if (live && sim) p.set("sim", sim);
  else p.delete("sim");
  if (!live) for (const k of ["speed", "paused", "traffic"]) p.delete(k);
  const url = `${window.location.pathname}?${p}${window.location.hash}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", url);
}
