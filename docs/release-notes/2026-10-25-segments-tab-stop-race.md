## Segment keyboard regression reliability

The inspector keyboard test now waits for each Home, End and arrow-key choice to appear in both
the saved policy and the rendered radio state before sending the next key. Focus moves before
the controlled choice commits; checking only focus after End allowed later assertions to match
the earlier Home state and Tab to enter the other segment instead of the timeout field.

The deadline-field focus assertion remains unchanged. This changes test synchronization only;
there are no product, UI text or parity golden changes.
