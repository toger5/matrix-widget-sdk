/**
 * No text selection while a drag is pressed or running: a press would start one, and the movement
 * of the drag stretches it over the page (the blue highlight). `user-select: none` on the document
 * and on the shadow host of `node` (the widget host renders into a shadow root), plus `selectstart`
 * cancelled on the window and on that shadow root: WebKit does not let `selectstart` out of a
 * shadow root, and Chromium honours the CSS only for selections that start after it is set.
 */
export function preventSelection(node: Node): () => void {
  const root = node.getRootNode();
  const shadow = root instanceof ShadowRoot ? root : undefined;
  const elements = [document.documentElement, ...(shadow ? [shadow.host as HTMLElement] : [])];
  // Locks nest (the press of a drag, then the drag itself): each element keeps its own value until its last lock goes.
  for (const el of elements) {
    const lock = locks.get(el);
    if (lock) lock.count++;
    else {
      locks.set(el, { count: 1, saved: [el.style.getPropertyValue("user-select"), el.style.getPropertyValue("-webkit-user-select")] });
      el.style.setProperty("user-select", "none");
      el.style.setProperty("-webkit-user-select", "none");
    }
  }
  const block = (e: Event) => e.preventDefault();
  window.addEventListener("selectstart", block, true);
  shadow?.addEventListener("selectstart", block, true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const el of elements) {
      const lock = locks.get(el)!;
      if (--lock.count > 0) continue;
      locks.delete(el);
      el.style.setProperty("user-select", lock.saved[0]);
      el.style.setProperty("-webkit-user-select", lock.saved[1]);
    }
    window.removeEventListener("selectstart", block, true);
    shadow?.removeEventListener("selectstart", block, true);
  };
}

const locks = new Map<HTMLElement, { count: number; saved: readonly [string, string] }>();

/** Clear a text selection, also one inside the shadow root of `node` (Chromium's `ShadowRoot.getSelection`). */
export function clearSelection(node: Node): void {
  document.getSelection()?.removeAllRanges();
  const root = node.getRootNode() as Node & { getSelection?(): Selection | null };
  if (root !== document) root.getSelection?.()?.removeAllRanges();
}
