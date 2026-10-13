import { notify } from "../../interop/ui/toast";
import { threads } from "./threadStore";

// A diagram made Private keeps its AI panel conversation (agents' turns from before, labels and copies of the
// diagram included): the "now private" toast offers to clear it, in one step, with Undo. Loaded only when the
// "now private" toast is shown, so the app's startup code carries none of this.

/**
 * Shows `text` (the "now private" toast) again with Clear conversation, when `documentId` has a conversation: the
 * store's, so one kept only in memory (storage full) counts too.
 */
export function offerToClearConversation(documentId: string, text: string): void {
  if (!threads.get(documentId).length) return;
  notify(text, {
    kind: "success",
    action: {
      label: "Clear conversation",
      testId: "private-clear-conversation",
      run: () => {
        const previous = threads.get(documentId);
        threads.set(documentId, []);
        notify("Conversation cleared.", {
          action: {
            label: "Undo",
            run: () => threads.update(documentId, (t) => (t.length ? t : previous)),
            testId: "private-clear-undo",
          },
        });
      },
    },
  });
}
