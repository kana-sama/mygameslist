/** Traverse the composed tree, including nested open shadow roots and slots. */
export function smartFocusableElements(root: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];
  const visit = (parent: Element | ShadowRoot) => {
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement) || child.hidden || child.inert || child.getAttribute("aria-hidden") === "true") continue;
      const style = getComputedStyle(child);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (child.matches('button, input, select, textarea, a[href], area[href], iframe, [tabindex], [contenteditable="true"], audio[controls], video[controls]') && child.tabIndex >= 0 && !child.matches(":disabled")) elements.push(child);
      if (child instanceof HTMLSlotElement && child.assignedElements().length) {
        for (const assigned of child.assignedElements()) {
          if (assigned instanceof HTMLElement) {
            if (assigned.tabIndex >= 0 && !assigned.matches(":disabled")) elements.push(assigned);
            visit(assigned.shadowRoot ?? assigned);
          }
        }
      } else visit(child.shadowRoot ?? child);
    }
  };
  visit(root);
  return elements.map((element, index) => ({ element, index })).sort((a, b) => {
    const left = a.element.tabIndex > 0 ? a.element.tabIndex : Infinity;
    const right = b.element.tabIndex > 0 ? b.element.tabIndex : Infinity;
    return left - right || a.index - b.index;
  }).map(({ element }) => element);
}

export function deepestActiveElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

export function composedContains(root: HTMLElement, node: Element | null): boolean {
  while (node) {
    if (root.contains(node)) return true;
    const tree = node.getRootNode();
    node = tree instanceof ShadowRoot ? tree.host : null;
  }
  return false;
}
