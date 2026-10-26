## Tutorial values and visible names · PR #356, review round two

The learner sees the exact query the solution types. Search uses a stable catalog alias in every language;
a newly created node's goto query uses its stored label. The command choice uses the app's translated
label. This preserves localized explanations without asking learners to type values the app cannot find.
The filter instruction likewise shows `OrderShipped`, the actual message type.

Tutorial chips keep their existing appearance and controls. Their accessible names now combine the
visible chip text and example title, so speaking the translated visible text identifies the same action.
Technical percentiles and units retain their spelling. No new controls or chrome were added.

Rejected separate translations of executable search/filter values and changes to palette matching: these
would retain duplicated sources of truth or change editor behavior to compensate for lesson copy.
