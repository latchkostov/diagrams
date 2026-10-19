## Engine ledger review fixes

Internal bookkeeping and regression coverage only. No controls, text, layout,
interaction or chrome changes. Delivery and completion traces match master across
pauses, nested requests and decimal scales. Existing wall-time reply deadlines
remain the behavior contract for this refactor; a new pause policy belongs in a
separate behavior change. Public showcases already demonstrate calls that wait;
this review adds no simulation feature requiring another example.
