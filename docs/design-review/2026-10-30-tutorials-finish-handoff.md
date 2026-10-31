## Lesson-finish handoff UX review

The sheet follows Direction 1’s non-modal placement and borrows Direction 3’s next-lesson intro. One ink primary action starts the next unfinished lesson without another intro confirmation. Chapter and syllabus seals stay inline; only newly earned seals enter the existing polite live region. There is no new persistent control, toast, sound or celebratory animation.

The designer review identified an inherited view entrance animation, an imprecise All tutorials label and lost focus after dismissal. The implementation disables the animation, uses the exact action label and returns focus to the canvas. Heading focus and DOM order put Start one Tab away without trapping keyboard or pointer input. Existing focus tokens and light/dark surface tokens retain contrast.

The 390 px capture exposed the app chrome’s mobile grid collapsing the practice canvas. Tutorial-specific row sizing fixes it; the sheet’s body scrolls between a visible heading and actions. The regression checks the heading and return action in the viewport. Desktop, dark and phone captures are recorded in the task’s built-2 directory.

Rejected: a modal dialog, redundant next-lesson confirmation, added award storage, first-lesson seals, animations and toast announcements. The handoff uses existing progress dates and retained seals. Lesson content and simulation behavior remain unchanged.
