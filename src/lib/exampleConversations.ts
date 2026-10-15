import { AI_THREAD_PREFIX } from "./aiThreadKey";
import { safeStorage } from "./storage";

// Canvas identities belong to mounted tabs. Only one durable conversation belongs to an
// unedited example; each tab keeps its own snapshot until promotion gives it a library owner.
const sessions = new Map<string, { slug: string; thread: string | null }>();
export const exampleConversationKey = (slug: string) => AI_THREAD_PREFIX + `example:${slug}`;

export function retainExampleConversation(identity: string, slug: string, thread: string | null): void {
  sessions.set(identity, { slug, thread });
}

/** Undefined means an ordinary document; null means an example's empty conversation. */
export function retainedExampleConversation(identity: string): string | null | undefined {
  return sessions.get(identity)?.thread;
}

export function saveExampleConversation(
  identity: string,
  thread: string | null,
  retained = thread,
): boolean | undefined {
  const session = sessions.get(identity);
  if (!session) return undefined;
  session.thread = retained;
  // An older mounted tab must not overwrite the most recently opened example's reload snapshot.
  if (safeStorage.getItem(`diagrams.example-session.v1:${session.slug}`) !== JSON.stringify(identity)) return true;
  const key = exampleConversationKey(session.slug);
  return thread === null ? safeStorage.removeItem(key) : safeStorage.setItem(key, thread);
}

export function transferExampleConversation(identity: string): void {
  sessions.delete(identity);
}
