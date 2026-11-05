/** Theme colours the canvas can't read from CSS by itself (from tokens.css, see `readParticleTokens`). */
export interface ParticleTokens {
  /** Centre of a particle head (--particle-core). */
  core: string;
  /** Glow strength 0..1 (--particle-glow-opacity) and size in px (--particle-glow-blur). */
  glowOpacity: number;
  glowBlur: number;
  /** Retry particles (--status-paused), dead letters (--live-dlq), failure flashes (--status-down). */
  retry: string;
  dlq: string;
  fail: string;
}

export const DEFAULT_TOKENS: ParticleTokens = {
  core: "#ffffff",
  glowOpacity: 0.5,
  glowBlur: 6,
  retry: "#d99000",
  dlq: "#d1393f",
  fail: "#d1393f",
};

/** Reads the particle tokens off the document (call after the theme attribute changed). */
export function readParticleTokens(el: Element = document.documentElement): ParticleTokens {
  const cs = getComputedStyle(el);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  const n = (name: string, fallback: number) => {
    const x = parseFloat(v(name));
    return Number.isFinite(x) ? x : fallback;
  };
  return {
    core: v("--particle-core") || DEFAULT_TOKENS.core,
    glowOpacity: n("--particle-glow-opacity", DEFAULT_TOKENS.glowOpacity),
    glowBlur: n("--particle-glow-blur", DEFAULT_TOKENS.glowBlur),
    retry: v("--status-paused") || DEFAULT_TOKENS.retry,
    dlq: v("--live-dlq") || v("--status-down") || DEFAULT_TOKENS.dlq,
    fail: v("--status-down") || DEFAULT_TOKENS.fail,
  };
}

/** The message under a pane point within `radius`, from hit targets laid out as x, y, message id. */
export function hitTestPoints(hits: ArrayLike<number>, x: number, y: number, radius = 12): number | undefined {
  let best: number | undefined;
  let bestD = radius * radius;
  for (let i = 0; i + 2 < hits.length; i += 3) {
    const dx = hits[i] - x,
      dy = hits[i + 1] - y,
      d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = hits[i + 2];
    }
  }
  return best;
}
