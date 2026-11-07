## Explicit password input and unchanged exported viewer

The preferred route keeps the password out of the conversation: Claude asks the user to create a
local text file and provide its path, then passes that path to the exporter without opening or
echoing it. The literal-value fallback explains its transcript, history and process-list exposure
before the user chooses it. Missing, conflicting, unreadable and short inputs fail without writing
an export or printing the supplied password. The same instructions and script serve both installs.

No editor control or chrome is added. Viewer packaging changes only its installed representation;
reassembled HTML keeps the existing fonts, script, CSS, CSP hashes and complete file bytes. The
downloaded ZIP is exercised outside the repository, including offline password unlock and playback.
