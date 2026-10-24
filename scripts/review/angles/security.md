Angle: SECURITY, PRIVACY & ROBUSTNESS. Untrusted input: imported files (.json/.drawio/.mmd), pasted
text, share links (#d=), URL params, SVG icons, labels rendered as HTML (XSS), decompression bombs,
prototype pollution, huge inputs, OAuth/token handling (Google Drive), postMessage/embed, CSP headers,
localStorage data, dependency risks. Apply common.md's approved P1 rubric: show the untrusted entry
point AND superlinear or unbounded memory/time for a resource-bound P1. A finite large local input,
missing display cap or hypothetical bomb without a reachable amplification path is P2. Real reachable
privacy/security leaks remain P1. Inspect public build guards without reading confidential inputs.
