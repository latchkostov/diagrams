// Slow motion's pacing (src/live/slowmo/script.ts tells the journey with it). Its own module, so the live view can
// read it without downloading the script code, which loads when slow motion first starts.

/** Every pacing constant in one place (wall milliseconds at 1×; the speed select scales the clock). */
export const PACING = {
  /** Screen speed of a hop: a mean of 260 px/s (about 6°/s at laptop distance). */
  pxPerSecond: 260,
  travelMin: 900,
  travelMax: 1800,
  /** Lift-off (the dot grows at the node border) and landing (the arrival ring), inside travel. */
  liftOff: 150,
  landing: 250,
  establish: 800,
  /** Processing dwell: clamp(0.55 + 0.22·log2(1 + ms/25), 0.6, 1.6) s. */
  processBase: 550,
  processPerDoubling: 220,
  processScale: 25,
  processMin: 600,
  processMax: 1600,
  /** Waiting (backlog, lag) dwell: clamp(0.5 + 0.3·log2(1 + ms/100), 0.5, 2.0) s; shown above 20 ms. */
  waitBase: 500,
  waitPerDoubling: 300,
  waitScale: 100,
  waitMin: 500,
  waitMax: 2000,
  waitThreshold: 20,
  append: 450,
  split: 400,
  /** A write ends with the dot sinking into the store. */
  sink: 300,
  /** Replies travel at 0.6 × a hop and never hold anything up. */
  replyFactor: 0.6,
  dlqFactor: 1.2,
  /** Failed attempts after the 2nd fold into one beat. */
  retriesShown: 2,
  collapse: 1200,
  drop: 600,
  end: 1200,
  /** Copies leaving a node together beyond this are summed up in one pill ("×6 OrderPlaced"). */
  maxLanes: 4,
  /** prefers-reduced-motion: every beat is a still state held this long, cross-fading in 200 ms. */
  reducedHold: 1500,
  reducedFade: 200,
  /** A script longer than this gets a warning in the trace card. */
  longScript: 60_000,
} as const;
