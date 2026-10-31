/** Run in the page: an opacity entrance is not the settled surface whose contrast we measure. */
export async function waitForViewEntranceInPage() {
  await Promise.allSettled(
    document
      .getAnimations()
      .filter((animation) => animation instanceof CSSAnimation && animation.animationName === "view-in")
      .map((animation) => animation.finished),
  );
}
