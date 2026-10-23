## Self-host smoke boot isolation and evidence

The self-host smoke now runs Chromium in the matching Playwright image, with a fixed network
namespace and a tunnel for the host's loopback endpoints. Docker deployment networks can change
without aborting the browser's startup modules. Each check still opens a fresh browser and fresh
host/guest contexts. The assertions and 30-second boot backstop are unchanged; there are no assertion
retries.

A controlled Linux reproduction changed Docker networks after the document response, while startup
assets were downloading. Chromium reported `net::ERR_NETWORK_CHANGED` for JavaScript chunks and
left the original static fallback visible until the brand assertion failed. The final head retained
the correct subpath base. An HTTP readiness probe cannot establish the browser's network stability.
This reproduces the CI symptom; historical CI logs did not capture request errors, so their exact
trigger cannot be independently confirmed.

Failures now print console/page errors, failed requests, HTTP statuses and URLs, CSP violation
details, every final page's head, and deployment container logs before cleanup. Detached proxy
processes write to the container's log streams so nginx/Caddy errors are actually retained.

Regression tests require network isolation, the pinned browser image, the loopback tunnel, cleanup
and failure diagnostics. Longer timeouts and blind navigation retries were rejected because they
would hide an aborted module graph. No app, proxy policy, asset path or output golden changes.
