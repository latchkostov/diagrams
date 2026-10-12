// OAuth redirect target for Diagrams' storage providers (OneDrive, Dropbox). It hands the
// redirect's query to the Diagrams tab that opened this popup and closes. Nothing is stored,
// nothing is sent anywhere else, and the code is removed from the address bar at once.
// See src/interop/storage/oauth.ts.
(function () {
  var params = {};
  new URLSearchParams(location.search).forEach(function (v, k) {
    params[k] = v;
  });
  history.replaceState(null, "", location.pathname);
  var msg = document.getElementById("msg");
  if (!params.state) {
    msg.textContent = "Nothing to do here. You can close this window.";
    return;
  }
  var message = { type: "diagrams-oauth", params: params };
  // A BroadcastChannel still reaches the app when the sign-in page cut this popup off from its opener.
  try {
    var channel = new BroadcastChannel("diagrams-oauth");
    channel.postMessage(message);
    channel.close();
  } catch {
    // No BroadcastChannel, or no opener: the other path carries the result.
  }
  try {
    if (window.opener && window.opener !== window) window.opener.postMessage(message, location.origin);
  } catch {
    // No BroadcastChannel, or no opener: the other path carries the result.
  }
  setTimeout(function () {
    window.close();
    msg.textContent = params.error
      ? "Sign-in didn't finish. You can close this window."
      : "Signed in. You can close this window.";
  }, 60);
})();
