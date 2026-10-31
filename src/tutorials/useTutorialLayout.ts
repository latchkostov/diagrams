import { useLayoutEffect } from "react";

/** Live's phone note must fit below teaching chrome, including when the visual viewport shrinks. */
export function useTutorialLayout() {
  useLayoutEffect(() => {
    const root = document.querySelector<HTMLElement>('[data-testid="tutorial-app"]');
    if (!root) return;
    let frame = 0;
    const observed = new WeakSet<Element>();
    const measure = () => {
      frame = 0;
      const bar = root.querySelector('[data-testid="tutorial-bar"]');
      const tools = root.querySelector('[data-testid="tutorial-tools"]');
      const caption = root.querySelector('[data-testid="live-caption-mount"]');
      if (!bar || !caption) return;
      for (const el of [bar, caption, ...(tools ? [tools] : [])]) {
        if (!observed.has(el)) {
          sizes.observe(el);
          observed.add(el);
        }
      }
      const visual = window.visualViewport;
      const top = Math.max(
        bar.getBoundingClientRect().bottom,
        tools?.getBoundingClientRect().bottom ?? 0,
        visual?.offsetTop ?? 0,
      );
      const bottom = Math.min(
        caption.getBoundingClientRect().bottom,
        (visual?.offsetTop ?? 0) + (visual?.height ?? window.innerHeight),
      );
      root.style.setProperty("--tutorial-note-room", `${Math.max(0, bottom - top - 8)}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const sizes = new ResizeObserver(schedule);
    sizes.observe(root);
    // Portal insertion and expansion must clamp before the next paint, including with a paused animation clock.
    const mutations = new MutationObserver(measure);
    mutations.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "hidden", "data-expanded"],
    });
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    measure();
    return () => {
      if (frame) cancelAnimationFrame(frame);
      sizes.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      root.style.removeProperty("--tutorial-note-room");
    };
  }, []);
}
