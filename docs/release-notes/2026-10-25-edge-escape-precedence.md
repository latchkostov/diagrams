## Escape reaches pending connection naming

Escape now finishes pending naming before dismissing a message-types tooltip, including while the
connection Inspector is downloading. Before typing it cancels naming; after typing it saves the held
name when the field arrives and returns focus to the connection. Dialogs and menus keep precedence.
Read-only viewers still dismiss message cards with Escape.

No controls or UI text were added. No parity goldens changed; diagram, simulation and export output
are unchanged.
