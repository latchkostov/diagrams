import { notify, toast } from "../../interop/ui/toast";
import { threads } from "./threadStore";

// A diagram made Private keeps its AI panel conversation (agents' turns from before, labels and copies of the
// diagram included): the "now private" toast offers to clear it, in one step, with Undo. Loaded only when the
// "now private" toast is shown, so the app's startup code carries none of this.

/**
 * Gives the "now private" toast `shown` Clear conversation, when `documentId` has a conversation: the store's, so one
 * kept only in memory (storage full) counts too. `stillCurrent` says whether the person is still on that diagram, and
 * it is still private: this code loads later, and by then they may have moved on. The toast keeps its place: shown,
 * or waiting (behind a toast in use, a dialog, or its own download), it gets the action wherever it is, and nothing
 * once it has gone.
 */
export function offerToClearConversation(documentId: string, shown: number, stillCurrent: () => boolean): void {
  if (!stillCurrent() || !threads.get(documentId).length) return;
  toast.attach(shown, {
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
  });
}
