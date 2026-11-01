## The keyboard recipe driver needs the native text-boundary mapping too

Round-six macOS fails dependencies-2's add-setting step. The screenshot shows the new key inserted
at the start of the existing first setting rather than on its own final line. The pointer driver
already maps `ControlOrMeta+End` to `Meta+ArrowDown` on macOS; the keyboard driver sent the recipe's
unmapped combo. It now uses that same existing mapping.

A browser regression starts a multiline field at its first character, plays document-end, Enter
and the setting through the keyboard driver, and checks the exact resulting text. The mapping's
unit coverage retains Windows/Linux combos and leaves ordinary Home/End and arrow keys alone.
Native macOS confirmation is reported in the round-seven verification; Windows alone cannot
establish macOS caret semantics. The protected edge-navigation camera policy is unchanged.
