import type { EdgeSimProps } from "./types";
import { holdsCallerThread } from "../stencils/freeCallerProfiles";

export interface CallPolicy {
  blocking: boolean;
  replyMs: number;
  pool?: number;
}

export const replyCpuMs = (cpuMs: number, replies: number) => cpuMs * 0.1 * replies;

/** Shared by playback, planning and connection editing. Older revisions never execute it. */
export function callPolicy(stencil: string, caller?: EdgeSimProps["caller"]): CallPolicy {
  const blocking = holdsCallerThread(stencil, caller?.wait);
  return {
    blocking,
    replyMs: blocking ? 0 : (caller?.replyMs ?? 10),
    pool: !blocking ? caller?.poolConnections : undefined,
  };
}
