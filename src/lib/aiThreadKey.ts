/**
 * Where the AI panel keeps a diagram's conversation (src/ai/ui/thread.ts): one key per diagram identity. Here, apart
 * from the panel's code, so deleting or replacing a diagram (./diagramIO.ts) can drop its conversation too.
 */
export const AI_THREAD_PREFIX = "diagrams.ai-thread.v1:";
