export type ScrollContainer = HTMLElement | Window;

export function isElementScrollContainer(container: ScrollContainer): container is HTMLElement {
  return container !== window;
}

export function findScrollContainer(element: HTMLElement | null): ScrollContainer {
  let current = element?.parentElement || null;
  while (current) {
    if (current.classList.contains("n-layout-scroll-container")) return current;
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(style.overflowY) && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return window;
}

export function getScrollTop(container: ScrollContainer): number {
  if (!isElementScrollContainer(container)) return window.scrollY;
  return container.scrollTop;
}

export function setScrollTop(container: ScrollContainer, value: number): void {
  const top = Math.max(0, Math.round(value));
  if (!isElementScrollContainer(container)) {
    window.scrollTo({ top, behavior: "auto" });
  } else {
    container.scrollTo({ top, behavior: "auto" });
  }
}
