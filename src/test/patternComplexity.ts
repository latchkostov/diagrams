import { growth } from "./complexity";
import { opGrowth } from "./opCounter";

/** JS scans are counted in unit CI. Native regexp backtracking is additionally timed only in Benchmarks. */
export const patternGrowth = process.env.COMPLEXITY_TIMING === "1" ? growth : opGrowth;
