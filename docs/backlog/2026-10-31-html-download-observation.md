## Download-event observations

The HTML download helper described its toast check as happening at download time, but awaited both the download event and the click acknowledgement first. A native click acknowledgement can outlive the short-lived notification. Saving to disk was already deferred; the remaining race was before that stage.

The callback now starts from the actual download event while the helper still waits for click completion before saving. A real-download regression holds only the click acknowledgement and requires the observer and existing notification to be available before releasing it. The exact toast and downloaded title assertions remain. No timeout, budget, product behavior or golden changes.

Both Windows cases pass, including the complete offline export test. Temporarily restoring the old ordering fails the new regression because the download observer never starts while the click acknowledgement is held. Linux repeats both cases twice.
