## Self-hosted collaboration review fixes

Offline packages now force collaboration off even when the shell or environment files enable it.
Their production bundles contain no room code or collaboration endpoints.

A rejected guest sees “This room is full.” without an invented participant count. The relay now
distinguishes its server room-count limit, which says the collaboration server is at capacity and
suggests trying later. Refusals carry no verified room limit, so no capacity number is displayed.
Private Share remains closed to privacy changes in server mode, including copies with share links enabled.

The only intended changed parity golden is `node/i18n/catalogs.json`: the count-free room message
and new server-capacity message change the English catalog and fallback hashes. No diagram,
simulation, layout, export or image output changes.
