import { notify } from "../../interop/ui/toast";
import { threads } from "./threadStore";

// A diagram made Private keeps its AI panel conversation (agents' turns from before, labels and copies of the
// diagram included): the "now private" toast offers to clear it, in one step, with Undo. Loaded only when the
// diagram has a conversation, so the app's startup code carries none of this.

/** Shows `text` (the "now private" toast) with Clear conversation, for the conversation of `documentId`. */
export function offerToClearConversation(documentId: string, text: string): void {
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
