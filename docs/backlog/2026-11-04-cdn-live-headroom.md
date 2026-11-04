## Live and Arabic core headroom after CDN PR 4

Owner: the next Live/locale bundle-trim batch. Keep this independent of the CDN
feature and keep every budget and reserve fixed.

The measured Live increment is 128,196 bytes gzip: 6,804 bytes remain against
135,000, only 660 beyond the 6,144-byte reserve. This is below the 8,192-byte
warning floor. Arabic core is 37,988 bytes against its fixed 38,000-byte cap.
The new purge-window words remain in the lazy Live readout; deploy markers reuse
the existing Deployment term. No unrelated trim or budget increase was made.

Give optional copy its correct loading boundary and remove repeated readout
copy in a dedicated follow-up. Do not shorten meaning or drop translations to
make these limits pass. The normal startup, canvas, Live, locale, skill ZIP and
checkpoint gates remain required.
