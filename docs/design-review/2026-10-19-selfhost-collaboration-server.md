## Self-host S5 deployment and documentation review

No editor controls, dialogs, canvas layout or consent text change in S5. The default static chart retains its
exact rendered output; server mode is an explicit deployment choice with one image and one replica.

The guide separates build-time transport choices from runtime relay settings, starts deployment with the
existing Compose service, and links advanced proxy/Helm layouts. Security limits are stated at the point of
use: SSO/VPN for access, trusted forwarding chains for quotas, no server persistence, and no Private-diagram
escape hatch. Troubleshooting gives concrete next checks for unreachable/full rooms and cross-origin CSP.

Rejected extra auth/database controls, runtime config discovery, public tracker changes and image publication:
they are outside S5 and would change the approved deployment/security contract. Other ingress controllers need
their own WebSocket settings; the chart documents this rather than implying nginx annotations are portable.
