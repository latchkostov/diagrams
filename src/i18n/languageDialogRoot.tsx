import { createRoot, type Root } from "react-dom/client";
import { LanguageDialog } from "../components/LanguageDialog";

// The Language dialog mounts on a root of its own (./load.ts opens it), so the app's tree carries none of it.

let root: Root | null = null;

/** Mounts the dialog on its own root (the app's tree carries none of it); closing unmounts it. */
export function showLanguageDialog(): void {
  if (root) return;
  const host = document.createElement("div");
  document.body.append(host);
  const mine = createRoot(host);
  root = mine;
  const close = () =>
    queueMicrotask(() => {
      mine.unmount();
      host.remove();
      if (root === mine) root = null;
    });
  mine.render(<LanguageDialog onClose={close} />);
}
