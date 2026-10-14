import { formatAgo as formatAgoEnglish } from "../lib/time";
import { state } from "./index";

/** Startup's relative time formatter stays separate from the numeric planning formatters. */
export const formatAgo = (at: number, now = Date.now()): string => (state.a ?? formatAgoEnglish)(at, now);
