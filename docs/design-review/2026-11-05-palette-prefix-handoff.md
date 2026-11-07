## Command input ownership

The full caching fix-round gate exposed a command search containing only
`m properties` after typing `diagram properties`. The loading dialog's passive
cleanup precedes search focus, while the palette previously released buffered
keys in layout. Keep that capture until the passive focus setup has run.

This changes no control, copy, focus destination or modal dismissal behavior.
Keyboard ownership stays continuous during the transition. A deterministic DOM
test supplies the prefix at the focus boundary and verifies the complete query
and command. Its mutation loses the prefix under the original layout handoff.
