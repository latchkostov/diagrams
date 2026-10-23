## Self-host smoke boot review

This changes verification infrastructure only. The smoke exercises the same branding, canvas,
sharing and two-way collaboration behavior, with the same assertions and boot backstop. Browser
network isolation removes host Docker interface changes from those checks. Failure evidence is
written to CI logs before cleanup. The editor gains no controls, text or visible layout changes.
