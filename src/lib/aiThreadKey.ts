/**
 * Where the AI panel keeps a diagram's conversation (src/ai/ui/thread.ts): owned diagrams use their identity;
 * unedited examples keep one durable reload snapshot (./exampleConversations.ts). Here, apart
 * from the panel's code, so deleting or replacing a diagram (./diagramIO.ts) can drop its conversation too.
 */
export const AI_THREAD_PREFIX = "diagrams.ai-thread.v1:";
