import { markWorkerUnsupported } from "../../live/liveRenderer";
import { STORAGE_KEY } from "../../harness/settings";
import { readPayload } from "./payload";

// The viewer's set-up, once storage is isolated (./storage, imported before this).
//
// Rendering: the live particles draw on the main thread (the renderer's own fallback). A module worker can't
// load from file:// or from a data block, and a blob: worker would need worker-src blob:, which a host's own
// CSP (SharePoint's, say) may refuse; the main-thread path works everywhere the page does.
markWorkerUnsupported();

// The exported theme, through the app's own settings (read once, when the viewer mounts). A password-protected
// file carries its theme in the clear, so its password prompt already paints in it.
const payload = readPayload();
const theme = payload.ok ? payload.options.theme : (payload.locked?.theme ?? "light");
localStorage.setItem(STORAGE_KEY, JSON.stringify({ theme }));
document.documentElement.dataset.theme = theme;
document.documentElement.style.colorScheme = theme;
