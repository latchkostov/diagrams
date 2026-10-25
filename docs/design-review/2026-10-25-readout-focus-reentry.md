## PR #320 final focus re-entry review

Keyboard re-entry is an explicit choice to read the same details again. Cancelling
an earlier focus claim must not prevent that choice. The loading stop can reacquire
ownership, while completion alone cannot take focus back from the opener, another
control, a menu or a newer target. Eligibility remains checked at completion.

No controls, copy, layout or styling change; the chrome budget is unchanged.
The held-download browser regression checks each keyboard destination before
releasing the chunk, then requires focus on the pinned card. Unit coverage checks
all 112 state/payload combinations, including ignored events and focus commands.
