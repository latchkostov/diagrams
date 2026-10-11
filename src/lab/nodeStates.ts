/** Node body states the matrix can show. */
export const NODE_STATES = ["default", "selected", "long-label", "no-sublabel", "unknown", "missing-icon"] as const;
export type NodeState = (typeof NODE_STATES)[number];
