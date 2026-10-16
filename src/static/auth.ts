import { t } from "../i18n/core";
import { startStaticPage } from "./start";
import { find } from "./dom";

// Clear credentials and deliver the result synchronously, before any language work.
const params = Object.fromEntries(new URLSearchParams(location.search));
history.replaceState(null, "", location.pathname);
const message = find('[data-testid="auth-message"]');
let finished = false;
const render = () => {
  document.title = t("staticAuth.title");
  message.textContent = !params.state
    ? t("staticAuth.nothing")
    : !finished
      ? t("staticAuth.finishing")
      : params.error
        ? t("staticAuth.failed")
        : t("staticAuth.signedIn");
};
if (!params.state) render();
else {
  const result = { type: "diagrams-oauth", params };
  try {
    const channel = new BroadcastChannel("diagrams-oauth");
    channel.postMessage(result);
    channel.close();
  } catch {
    // The opener path still works where BroadcastChannel is unavailable.
  }
  try {
    if (window.opener && window.opener !== window) window.opener.postMessage(result, location.origin);
  } catch {
    // BroadcastChannel still reaches the app when the provider cuts off the opener.
  }
  setTimeout(() => {
    window.close();
    finished = true;
    render();
  }, 60);
}
void startStaticPage(render);
