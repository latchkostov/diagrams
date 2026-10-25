## Fan-out and RAG design studies restored

Fan-out now identifies each channel queue by its incoming router connection and its dead-letter
queue by the channel queue's connection. Creating a dead-letter queue first no longer binds it
as the main queue (R-14ca23f114).

RAG's answer-budget milestone requires Request flows along the measured answer path. Sending
model work as a Message cannot claim a fast answer; Skip restores those Requests before rerunning
the reference design (R-9882472c56).

Both studies return to the tutorial catalog and generated browser cases. Regression coverage also
checks that untouched starting diagrams fail every milestone throughout their saved runs, and
independently rejects backup failures and drops during Cells evacuation (R-544d5952ee).

No parity goldens changed. This fix round uses the scoped catalog, completion sweep and generated
browser cases; the full suite and parity remain for CI.
