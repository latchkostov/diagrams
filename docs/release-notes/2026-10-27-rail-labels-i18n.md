## Rail labels fit in every language

Every rail item now has dedicated short copy in English and all 37 translated languages. Add no longer
uses a message-types key. Spanish Checks reads “Revisar”; full names remain in tooltips and accessible
labels, including warning counts.

Labels wrap onto at most two centred lines with language-aware hyphenation and word breaking. Narrow
buttons reduce the font with a CSS container-width clamp, stopping at 10.5 px. The phone Edit bar shows the
same labels and grows from 56 to 64 px; the tablet rail keeps its compact icons.

Shorter forms replace existing full labels in Arabic, German, Greek, Spanish, Estonian, Finnish,
French, Hebrew, Hungarian, Indonesian, Italian, Japanese, Lithuanian, Norwegian Bokmål, Dutch,
Serbian Latin, Thai, Turkish and Vietnamese. Other languages retain their existing wording under
dedicated rail keys. All languages gain translated Add text.

The real-font browser guard covers every language, English and the pseudo-locale at 1280 and 320 px,
including secondary items and the return-to-diagram action. Its long-label mutation also checks that
clipping cannot conceal a regression.

## Output parity

Only `node/i18n/catalogs.json` changes: nine new `rail.*` messages and their per-language hashes/counts.
The existing message-types Add hash also changes because the compiler shares identical plain English
messages: its previously missing translation now resolves to the translated Add sibling. Other areas
and diagram/export/simulation output remain unchanged.
